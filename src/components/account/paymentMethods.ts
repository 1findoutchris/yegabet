/* Shared payment-method config for the deposit flow.
   `agent*` fields are the destination account the player sends money to;
   they're shown on the per-method deposit page so the user knows where to
   transfer before pasting their confirmation SMS. (Placeholder values —
   swap for the real agent accounts when wiring the backend.) */

export type MethodId = "telebirr" | "cbebirr" | "ebirr";

export interface PaymentMethod {
  id: MethodId;
  name: string;
  desc: string;
  accent: string;
  logo: string;
  /** Label for the destination account field, e.g. "telebirr number". */
  agentLabel: string;
  /** Destination account / phone number to send the deposit to. */
  agentNumber: string;
  /** Registered holder name of the destination account. */
  agentName: string;
  /**
   * Rail-specific caution shown next to the account details, at the moment the
   * player is about to transfer. Optional — most methods need none.
   */
  warning?: string;
}

export const PAYMENT_METHODS: PaymentMethod[] = [
  {
    id: "telebirr",
    name: "telebirr",
    desc: "Ethio Telecom mobile money",
    accent: "#F0285A",
    logo: "/payment/telebirr.svg",
    agentLabel: "telebirr number",
    agentNumber: "0912 345 678",
    agentName: "Yega Agent",
  },
  {
    id: "cbebirr",
    name: "CBE Birr",
    desc: "Commercial Bank of Ethiopia",
    accent: "#7C3AED",
    logo: "/payment/cbebirr.svg",
    agentLabel: "CBE account number",
    agentNumber: "1000 1234 5678",
    agentName: "YegaBetting PLC",
    // A transfer from any other bank arrives without the CBE Birr confirmation
    // SMS the auto-matcher reads, so it cannot be credited automatically.
    warning: "Only CBE Birr to CBE Birr transfers are accepted. Sending from another bank or wallet will not be credited.",
  },
  {
    id: "ebirr",
    name: "eBirr",
    desc: "eBirr mobile wallet",
    accent: "#059669",
    logo: "/payment/ebirr.webp",
    agentLabel: "eBirr number",
    agentNumber: "0712 345 678",
    agentName: "Yega Agent",
  },
];

export function getPaymentMethod(id: string): PaymentMethod | undefined {
  return PAYMENT_METHODS.find((m) => m.id === id);
}
