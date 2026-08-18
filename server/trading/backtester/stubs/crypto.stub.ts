import { createHash } from "crypto";

// ── CRYPTO STUB ──
export function isEncrypted(_val: any) {
  return false;
}
export function decrypt(val: any) {
  return val;
}
export function getShortHash(sig: string): string {
  return createHash("md5").update(sig).digest("hex").substring(0, 12);
}
export default { isEncrypted, decrypt, getShortHash };
