export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function formatTimestamp(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}
