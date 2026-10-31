// A DevOps PAT held in memory only. It cannot be logged, serialized or printed by accident:
// String(), JSON.stringify and util.inspect all show "[PAT]". Only basicAuth() reads the value,
// and only the DevOps HTTP client calls it, right at the request.
import { inspect } from "node:util";

export class Pat {
  readonly #value: string;
  constructor(value: string) {
    this.#value = value;
  }
  /** The Authorization header value: Basic base64(":" + PAT), per the Azure DevOps docs. */
  basicAuth(): string {
    return `Basic ${Buffer.from(`:${this.#value}`).toString("base64")}`;
  }
  toString(): string {
    return "[PAT]";
  }
  toJSON(): string {
    return "[PAT]";
  }
  [inspect.custom](): string {
    return "[PAT]";
  }
}
