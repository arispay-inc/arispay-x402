/**
 * payagent — Error classes.
 */

/** Base class for all payagent errors. */
export class PayAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayAgentError";
  }
}

/** The payment was signed and sent but the server still rejected it, or ArisPay refused to sign. */
export class PaymentRejectedError extends PayAgentError {
  public readonly status: number;

  constructor(status: number, message?: string) {
    super(message ?? `Server rejected payment (HTTP ${status})`);
    this.name = "PaymentRejectedError";
    this.status = status;
  }
}

/** Could not parse 402 response body as valid payment requirements. */
export class InvalidRequirementsError extends PayAgentError {
  constructor(detail?: string) {
    super(`Could not parse 402 payment requirements${detail ? `: ${detail}` : ""}`);
    this.name = "InvalidRequirementsError";
  }
}
