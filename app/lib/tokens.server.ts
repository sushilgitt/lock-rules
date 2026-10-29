import crypto from "node:crypto";

/*
 * Unlock token: "<conditionUid>.<expiresAtEpochSeconds>.<hex hmac>"
 * where hmac = HMAC-SHA256(secret, "<conditionUid>.<expiresAt>").
 *
 * Stored space-separated in the `_lr` cart attribute. Verified in Liquid with
 * the hmac_sha256 filter (lock_embed.liquid) and in the checkout function
 * (extensions/checkout-lock/src/hmac.ts). Keep all three in sync.
 */

export const TOKEN_ATTRIBUTE = "_lr";
const DEFAULT_MINUTES = 30 * 24 * 60;

export function newSecret() {
  return crypto.randomBytes(32).toString("hex");
}

export function signToken(secret: string, uid: string, minutes?: number) {
  const exp = Math.floor(Date.now() / 1000) + 60 * (minutes && minutes > 0 ? minutes : DEFAULT_MINUTES);
  const payload = `${uid}.${exp}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}
