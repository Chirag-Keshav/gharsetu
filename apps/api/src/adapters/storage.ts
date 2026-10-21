/**
 * ObjectStorage adapter (SPEC §5): a `private` bucket (signed URLs only) and a `public` bucket that
 * holds published-listing photo variants only. Local filesystem driver for development; S3/MinIO
 * driver for deployed environments.
 */
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { hmac, safeEqual } from '../core/crypto';

export type Bucket = 'private' | 'public';

export interface PresignedUpload {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

export interface ObjectStorage {
  presignUpload(key: string, contentType: string, maxBytes: number, ttlSeconds: number): Promise<PresignedUpload>;
  presignDownload(key: string, ttlSeconds: number, filename?: string): Promise<string>;
  get(bucket: Bucket, key: string): Promise<Buffer | null>;
  put(bucket: Bucket, key: string, body: Buffer, contentType: string): Promise<void>;
  delete(bucket: Bucket, key: string): Promise<void>;
  size(bucket: Bucket, key: string): Promise<number | null>;
  publicUrl(key: string): string;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

const SAFE_KEY = /^[A-Za-z0-9/_.-]{1,300}$/;
export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes('..') || key.startsWith('/')) throw new Error('Unsafe object key');
}

export interface SignedParams {
  op: 'put' | 'get';
  key: string;
  exp: number;
  max?: number;
  ct?: string;
  fn?: string;
}

/** Filesystem driver. Uploads and downloads go through API routes guarded by HMAC-signed URLs. */
export class LocalObjectStorage implements ObjectStorage {
  constructor(
    private readonly baseDir: string,
    private readonly secret: string,
    private readonly apiBase = '/api/v1',
  ) {}

  private file(bucket: Bucket, key: string): string {
    assertSafeKey(key);
    return path.join(this.baseDir, bucket, ...key.split('/'));
  }

  sign(p: SignedParams): string {
    return hmac(this.secret, [p.op, p.key, p.exp, p.max ?? '', p.ct ?? '', p.fn ?? ''].join('|'));
  }

  verify(p: SignedParams, sig: string, nowMs = Date.now()): boolean {
    return p.exp * 1000 > nowMs && safeEqual(sig, this.sign(p));
  }

  async presignUpload(key: string, contentType: string, maxBytes: number, ttlSeconds: number): Promise<PresignedUpload> {
    const p: SignedParams = { op: 'put', key, exp: Math.floor(Date.now() / 1000) + ttlSeconds, max: maxBytes, ct: contentType };
    const qs = new URLSearchParams({ key, exp: String(p.exp), max: String(maxBytes), ct: contentType, sig: this.sign(p) });
    return { url: `${this.apiBase}/storage/upload?${qs}`, method: 'PUT', headers: { 'content-type': contentType } };
  }

  async presignDownload(key: string, ttlSeconds: number, filename?: string): Promise<string> {
    const p: SignedParams = { op: 'get', key, exp: Math.floor(Date.now() / 1000) + ttlSeconds, fn: filename };
    const qs = new URLSearchParams({ key, exp: String(p.exp), sig: this.sign(p), ...(filename ? { fn: filename } : {}) });
    return `${this.apiBase}/storage/download?${qs}`;
  }

  async get(bucket: Bucket, key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.file(bucket, key));
    } catch {
      return null;
    }
  }

  async put(bucket: Bucket, key: string, body: Buffer): Promise<void> {
    const f = this.file(bucket, key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, body);
  }

  async delete(bucket: Bucket, key: string): Promise<void> {
    await rm(this.file(bucket, key), { force: true });
  }

  async size(bucket: Bucket, key: string): Promise<number | null> {
    try {
      return (await stat(this.file(bucket, key))).size;
    } catch {
      return null;
    }
  }

  publicUrl(key: string): string {
    return `/media/${key}`;
  }

  publicDir(): string {
    return path.join(this.baseDir, 'public');
  }
}

export interface S3Options {
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  privateBucket: string;
  publicBucket: string;
  forcePathStyle: boolean;
  publicBaseUrl?: string;
}

/** S3-compatible driver (AWS S3, MinIO). */
export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly opts: S3Options) {
    this.client = new S3Client({
      endpoint: opts.endpoint,
      region: opts.region ?? 'ap-south-1',
      forcePathStyle: opts.forcePathStyle,
      credentials: opts.accessKeyId && opts.secretAccessKey ? { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey } : undefined,
    });
  }

  private name(bucket: Bucket): string {
    return bucket === 'private' ? this.opts.privateBucket : this.opts.publicBucket;
  }

  async presignUpload(key: string, contentType: string, _maxBytes: number, ttlSeconds: number): Promise<PresignedUpload> {
    assertSafeKey(key);
    const url = await getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.opts.privateBucket, Key: key, ContentType: contentType }), {
      expiresIn: ttlSeconds,
    });
    return { url, method: 'PUT', headers: { 'content-type': contentType } };
  }

  async presignDownload(key: string, ttlSeconds: number, filename?: string): Promise<string> {
    assertSafeKey(key);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.opts.privateBucket,
        Key: key,
        ResponseContentDisposition: filename ? `inline; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"` : undefined,
      }),
      { expiresIn: ttlSeconds },
    );
  }

  async get(bucket: Bucket, key: string): Promise<Buffer | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.name(bucket), Key: key }));
      return out.Body ? Buffer.from(await out.Body.transformToByteArray()) : null;
    } catch {
      return null;
    }
  }

  async put(bucket: Bucket, key: string, body: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.name(bucket),
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: bucket === 'public' ? 'public, max-age=86400' : undefined,
      }),
    );
  }

  async delete(bucket: Bucket, key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.name(bucket), Key: key }));
  }

  async size(bucket: Bucket, key: string): Promise<number | null> {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.name(bucket), Key: key }));
      return out.ContentLength ?? null;
    } catch {
      return null;
    }
  }

  publicUrl(key: string): string {
    const base = this.opts.publicBaseUrl ?? `${this.opts.endpoint ?? ''}/${this.opts.publicBucket}`;
    return `${base.replace(/\/$/, '')}/${key}`;
  }
}

/** MalwareScanner adapter (SPEC §14.1, P1): no-op in development; ClamAV in staging/production. */
export interface MalwareScanner {
  scan(body: Buffer): Promise<'CLEAN' | 'INFECTED'>;
}
export const MALWARE_SCANNER = Symbol('MALWARE_SCANNER');
export class NoopScanner implements MalwareScanner {
  async scan(): Promise<'CLEAN'> {
    return 'CLEAN';
  }
}

/** Content sniffing by magic numbers (SPEC §8.7 "Validate MIME type by content sniffing"). */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('ascii', 0, 4) === '%PDF') return 'application/pdf';
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
    if (brand === 'qt  ') return 'video/quicktime';
    return 'video/mp4';
  }
  return null;
}
