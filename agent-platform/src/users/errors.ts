export type UsersErrorCode =
  | "INVALID_PHONE"
  | "PHONE_TAKEN"
  | "TELEGRAM_TAKEN"
  | "INVALID_REFERRAL"
  | "INVALID_PARENT"
  | "SLUG_TAKEN"
  | "INVALID_INPUT"
  | "NOT_FOUND";

/** A refused users/agents operation. Nothing was written. */
export class UsersError extends Error {
  constructor(
    readonly code: UsersErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "UsersError";
  }
}
