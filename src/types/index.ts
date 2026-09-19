export type UserRole = "USER" | "AGENT" | "AFFILIATE" | "ADMIN" | "SUPERADMIN";

export type TransactionType = "DEPOSIT" | "WITHDRAWAL" | "BET" | "WIN" | "BONUS" | "COMMISSION" | "REFUND";

export type TransactionStatus = "PENDING" | "COMPLETED" | "FAILED" | "CANCELLED";

export type BetStatus = "PENDING" | "WON" | "LOST" | "CANCELLED" | "CASHOUT";

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SilentApiCallbackPayload {
  serial_number: string;
  currency: string;
  game_uid: string;
  member_account: string;
  win_amount: string;
  bet_amount: string;
  timestamp: string;
  game_round: string;
  data: unknown | null;
}

export interface SilentApiCallbackResponse {
  code: number;
  msg: string;
  balance: number;
}
