// Elapsed time, independent of local midnight and daylight-saving changes.
export const TRANSFER_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function transferExpired(touched, now = Date.now()) {
  return now - touched > TRANSFER_RETENTION_MS;
}
