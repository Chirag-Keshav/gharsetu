import { PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';

/** Validates a body/query/param with a shared zod schema (SPEC §12.9). Throws ZodError → 422. */
export class ZodPipe<S extends ZodTypeAny> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    return this.schema.parse(value ?? {});
  }
}

export const zp = <S extends ZodTypeAny>(schema: S) => new ZodPipe(schema);
