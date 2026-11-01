export class OperationError extends Error {
  constructor(public readonly code: string) { super(code); }
}
