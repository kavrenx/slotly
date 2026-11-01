import { z } from "zod";

export class DomainError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}
export function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new DomainError("INVALID_INPUT");
  return result.data;
}
