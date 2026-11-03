// A3: the store is async; views that build a row per item from the store do it one after another (a transaction on
// SQL Server takes one request at a time, and the order stays the list's).
export async function mapSeq<T, U>(xs: Iterable<T>, f: (x: T, i: number) => Promise<U>): Promise<U[]> {
  const out: U[] = [];
  let i = 0;
  for (const x of xs) out.push(await f(x, i++));
  return out;
}
