// ── METAAPI QUEUE STUB ──
// Directly calls the function without queuing.
export async function enqueueMetaApiRequest(
  fn: () => Promise<any>,
  _key?: string,
  _retries?: number,
  _onFail?: any,
) {
  try {
    return await fn();
  } catch (e) {
    console.error("ENQUEUE ERROR:", e);
    return null;
  }
}
export default { enqueueMetaApiRequest };
