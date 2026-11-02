// Read-back after a write (D255): a write can land while the read that checks it fails on the network. Wait briefly
// and read once more before calling the write Not confirmed. Only network errors are retried; anything else is final.
export const READ_BACK_WAIT_MS = 1500;
export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function readBack<T>(read: () => Promise<T>, isNetwork: (e: unknown) => boolean, sleep: Sleep = realSleep): Promise<T> {
  try {
    return await read();
  } catch (e) {
    if (!isNetwork(e)) throw e;
    await sleep(READ_BACK_WAIT_MS);
    return read();
  }
}
