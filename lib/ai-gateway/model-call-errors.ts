export class InvalidModelResponseError extends Error {
  constructor(
    message = 'Model response failed validation.',
    readonly validationErrors: string[] = [],
    readonly rejectedValue?: unknown,
  ) {
    super(message)
    this.name = 'InvalidModelResponseError'
  }
}

export class ContentRejectedError extends Error {
  constructor(
    message = 'Model content was rejected.',
    readonly validationErrors: string[] = [],
  ) {
    super(message)
    this.name = 'ContentRejectedError'
  }
}
