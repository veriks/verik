export function total(items: number[]) {
  let sum = 0;
  for (const i of items) sum += i;
  return sum;
}
