import * as crypto from 'crypto';

// Hardcoded reward amounts (dollars). No admin surface to configure them yet.
export const REFERRER_REWARD = 5;
export const REFEREE_REWARD = 5;

// Unambiguous uppercase alphabet (no 0/O/1/I) for human-shareable codes.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A random 8-char referral code. Uniqueness is enforced by the DB unique index
 * (callers retry on collision). */
export function generateReferralCode(length = 8): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
