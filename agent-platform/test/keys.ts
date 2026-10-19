/** Fixed test-only phone keys (never used outside tests). */
export const PHONE_KEYS = {
  PHONE_HASH_KEY: "h".repeat(32),
  PHONE_ENC_KEY: Buffer.alloc(32, 7).toString("base64"),
};

export const PHONE_KEY_PAIR = { hashKey: PHONE_KEYS.PHONE_HASH_KEY, encKey: PHONE_KEYS.PHONE_ENC_KEY };
