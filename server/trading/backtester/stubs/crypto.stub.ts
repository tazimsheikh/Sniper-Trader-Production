// ── CRYPTO STUB ──
export function isEncrypted(_val: any) {
  return false;
}
export function decrypt(val: any) {
  return val;
}
export function getShortHash(sig: string): string {
  // Stub: truncate to 12 chars. Production uses MD5 hash via Node.js crypto module.
  return sig.substring(0, 12);
}
export default { isEncrypted, decrypt, getShortHash };
