import { UsersError } from "../../src/users/errors";
import {
  decryptPhone,
  encryptPhone,
  hashPhone,
  maskPhone,
  normalizeEthiopianPhone,
} from "../../src/users/phone";
import { PHONE_KEY_PAIR } from "../keys";

describe("normalizeEthiopianPhone", () => {
  it.each([
    ["0912345678", "+251912345678"],
    ["912345678", "+251912345678"],
    ["+251912345678", "+251912345678"],
    ["251912345678", "+251912345678"],
    ["0912 345 678", "+251912345678"],
    ["(091) 234-5678", "+251912345678"],
    ["0712345678", "+251712345678"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeEthiopianPhone(input)).toBe(expected);
  });

  it.each(["", "12345", "0812345678", "+1 555 123 4567", "09123456789", "abc"])("refuses %p", (input) => {
    expect(() => normalizeEthiopianPhone(input)).toThrow(UsersError);
    expect(() => normalizeEthiopianPhone(input)).toThrow(/Ethiopian mobile/);
  });
});

describe("phone hashing and encryption", () => {
  it("hashes one number the same way whatever its format", () => {
    const a = hashPhone(normalizeEthiopianPhone("0912345678"), PHONE_KEY_PAIR.hashKey);
    const b = hashPhone(normalizeEthiopianPhone("+251 912 345 678"), PHONE_KEY_PAIR.hashKey);
    expect(a).toBe(b);
    expect(a).not.toContain("912345678");
    expect(hashPhone("+251912345678", "another-key-another-key-another-k")).not.toBe(a);
  });

  it("encrypts with a fresh IV each time and decrypts back", () => {
    const one = encryptPhone("+251912345678", PHONE_KEY_PAIR.encKey);
    const two = encryptPhone("+251912345678", PHONE_KEY_PAIR.encKey);
    expect(one).not.toBe(two);
    expect(one).not.toContain("912345678");
    expect(decryptPhone(one, PHONE_KEY_PAIR.encKey)).toBe("+251912345678");
  });

  it("refuses a tampered ciphertext or the wrong key", () => {
    const blob = Buffer.from(encryptPhone("+251912345678", PHONE_KEY_PAIR.encKey), "base64");
    blob[blob.length - 1] = (blob[blob.length - 1] as number) ^ 1;
    expect(() => decryptPhone(blob.toString("base64"), PHONE_KEY_PAIR.encKey)).toThrow();
    const good = encryptPhone("+251912345678", PHONE_KEY_PAIR.encKey);
    expect(() => decryptPhone(good, Buffer.alloc(32, 9).toString("base64"))).toThrow();
  });

  it("masks for display", () => {
    expect(maskPhone("+251912345678")).toBe("+251****5678");
  });
});
