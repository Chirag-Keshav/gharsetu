/**
 * Background job drivers (SPEC §5 "Queue / jobs"). BullMQ on Redis is the deployed driver; the
 * in-process driver keeps local development and tests free of a Redis dependency. Handlers are
 * idempotent either way.
 */
import { Queue, Worker } from 'bullmq';
import { errorFields, log } from '../../core/logger';

export type JobHandler = () => Promise<unknown>;

export interface QueueDriver {
  schedule(name: string, everyMs: number, handler: JobHandler): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

async function runSafely(name: string, handler: JobHandler) {
  try {
    await handler();
  } catch (err) {
    log.error('job_failed', { job: name, ...errorFields(err) });
  }
}

export class InProcessQueueDriver implements QueueDriver {
  private readonly jobs: Array<{ name: string; everyMs: number; handler: JobHandler }> = [];
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly running = new Set<string>();

  schedule(name: string, everyMs: number, handler: JobHandler): void {
    this.jobs.push({ name, everyMs, handler });
  }

  async start(): Promise<void> {
    for (const job of this.jobs) {
      const tick = async () => {
        if (this.running.has(job.name)) return; // never overlap the same job
        this.running.add(job.name);
        await runSafely(job.name, job.handler);
        this.running.delete(job.name);
      };
      this.timers.push(setInterval(() => void tick(), job.everyMs));
      setTimeout(() => void tick(), 1_000);
    }
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    this.timers.length = 0;
  }
}

/** Repeatable BullMQ jobs: one execution per tick across all API instances. */
export class BullMqQueueDriver implements QueueDriver {
  private readonly handlers = new Map<string, JobHandler>();
  private readonly every = new Map<string, number>();
  private queue?: Queue;
  private worker?: Worker;

  constructor(private readonly redisUrl: string) {}

  schedule(name: string, everyMs: number, handler: JobHandler): void {
    this.handlers.set(name, handler);
    this.every.set(name, everyMs);
  }

  async start(): Promise<void> {
    const url = new URL(this.redisUrl);
    const connection = { host: url.hostname, port: Number(url.port || 6379), password: url.password || undefined, username: url.username || undefined };
    this.queue = new Queue('propcare-jobs', { connection });
    for (const [name, everyMs] of this.every) {
      await this.queue.upsertJobScheduler(name, { every: everyMs }, { name, opts: { removeOnComplete: 100, removeOnFail: 500 } });
    }
    this.worker = new Worker(
      'propcare-jobs',
      async (job) => {
        const handler = this.handlers.get(job.name);
        if (handler) await handler();
      },
      { connection, concurrency: 4 },
    );
    this.worker.on('failed', (job, err) => log.error('job_failed', { job: job?.name, ...errorFields(err) }));
  }

  async stop(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
