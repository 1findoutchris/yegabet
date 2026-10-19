/** Typed ledger failures. Every one of them means nothing was written. */

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends LedgerError {}

/** The idempotency key was already used for a different request. */
export class IdempotencyConflictError extends LedgerError {
  constructor(readonly idempotencyKey: string) {
    super(`idempotency key "${idempotencyKey}" was already used for a different request`);
  }
}

export class InsufficientFundsError extends LedgerError {
  constructor(
    readonly accountId: bigint,
    readonly balance: bigint,
    readonly change: bigint,
  ) {
    super(`account ${accountId} would go negative: balance ${balance}, change ${change}`);
  }
}

export class AccountNotFoundError extends LedgerError {
  constructor(readonly accountIds: bigint[]) {
    super(`account(s) not found: ${accountIds.join(", ")}`);
  }
}

export class CurrencyMismatchError extends LedgerError {
  constructor(
    readonly debitAccountId: bigint,
    readonly creditAccountId: bigint,
  ) {
    super(`accounts ${debitAccountId} and ${creditAccountId} have different currencies`);
  }
}

export class TransactionNotFoundError extends LedgerError {
  constructor(readonly transactionId: bigint) {
    super(`ledger transaction ${transactionId} not found`);
  }
}

export class AlreadyReversedError extends LedgerError {
  constructor(readonly transactionId: bigint) {
    super(`ledger transaction ${transactionId} has already been reversed`);
  }
}
