export function total(items: number[]): number {
  return items.reduce((sum, i) => sum + i, 0);
}
