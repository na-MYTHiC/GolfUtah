/**
 * One-off helper: prints a fresh CREDENTIALS_ENCRYPTION_KEY for .env.
 * Usage: npm run generate-key
 */
import { generateEncryptionKey } from "../lib/crypto";

console.log(generateEncryptionKey());
