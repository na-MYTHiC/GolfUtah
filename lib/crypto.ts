import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for at-rest secrets — specifically, per-course
 * login credentials (see prisma schema `CourseCredential`).
 *
 * Golf platforms sometimes only show real availability (or member rates)
 * to a logged-in user, and eventual auto-booking needs the same thing —
 * so credentials have to be stored somewhere, and never in plaintext.
 *
 * Key: `CREDENTIALS_ENCRYPTION_KEY` in `.env`, a base64-encoded 32-byte
 * key (see `generateEncryptionKey` below to create one). Never commit a
 * real key or reuse the example value.
 *
 * Encrypted payload format (single base64url string, easy to store in one
 * text column): `iv (12 bytes) || authTag (16 bytes) || ciphertext`.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended IV length for GCM
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const keyB64 = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!keyB64) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY is not set. Generate one with " +
        "generateEncryptionKey() and add it to .env — see .env.example."
    );
  }
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) {
    throw new Error(
      `CREDENTIALS_ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}. ` +
        "Generate a new one with generateEncryptionKey()."
    );
  }
  return key;
}

/** Generate a new base64-encoded 32-byte key, for seeding .env. */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString("base64");
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]).toString("base64url");
}

export function decrypt(payload: string): string {
  const key = getKey();
  const raw = Buffer.from(payload, "base64url");

  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
