import crypto from "node:crypto";

// AES-256-GCM for third-party credentials at rest. ENCRYPTION_KEY is 64 hex
// chars; rotating it makes stored credentials unreadable (merchants reconnect).
function key() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error("ENCRYPTION_KEY must be set to 64 hex characters.");
  }
  return Buffer.from(hex, "hex");
}

export function encrypt(plain: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function decrypt(sealed: string) {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1") throw new Error("Unknown credential format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

export function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
