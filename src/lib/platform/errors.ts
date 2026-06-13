export type PlatformErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'GENERATION_FAILED'

export class PlatformError extends Error {
  constructor(
    public readonly code: PlatformErrorCode,
    message: string,
    public readonly status = 400
  ) {
    super(message)
    this.name = 'PlatformError'
  }
}

export function toPlatformError(error: unknown): PlatformError {
  if (error instanceof PlatformError) return error
  return new PlatformError(
    'GENERATION_FAILED',
    error instanceof Error ? error.message : String(error),
    500
  )
}
