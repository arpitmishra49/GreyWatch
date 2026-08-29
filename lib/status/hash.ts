// Deterministic pseudo-randomness keyed by site id — same site always
// gets the same mock status on every request (until a real API replaces
// these), rather than flickering randomly on each page load.
export function stableRatio(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return (hash >>> 0) / 0xffffffff;
}
