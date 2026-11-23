import { randomBytes, timingSafeEqual } from "node:crypto";
import { type BrowserSession, GATEWAY_LIMITS, GATEWAY_VERSION } from "../bridge/index.js";

export const sameSecret = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
type Session = { token: string; expires: number };

/** Sessions are local to one backend lifetime; pairing is explicit and single-use. */
export class Sessions {
  private readonly proofs = new Map<string, number>();
  private readonly sessions = new Map<string, Session>();
  private controller: string | undefined;
  generation = 0;
  constructor(private readonly now: () => number = Date.now) {}
  private prune() {
    for (const [code, expires] of this.proofs) if (expires <= this.now()) this.proofs.delete(code);
    for (const [token, session] of this.sessions)
      if (session.expires <= this.now()) {
        this.sessions.delete(token);
        if (this.controller === token) {
          this.controller = undefined;
          this.generation++;
        }
      }
  }
  proof() {
    this.prune();
    if (this.proofs.size >= GATEWAY_LIMITS.sessions)
      throw new Error("Too many pairing requests. Try again later.");
    const proof = randomBytes(8).toString("hex");
    this.proofs.set(proof, this.now() + GATEWAY_LIMITS.pairingMs);
    return proof;
  }
  pair(proof: string): BrowserSession {
    this.prune();
    if (!this.proofs.delete(proof) || this.sessions.size >= GATEWAY_LIMITS.sessions)
      throw new Error("Pairing code is invalid or expired.");
    const token = randomBytes(32).toString("hex");
    this.sessions.set(token, { token, expires: this.now() + GATEWAY_LIMITS.sessionMs });
    if (!this.controller) {
      this.controller = token;
      this.generation++;
    }
    return this.describe(token);
  }
  authenticate(value: string | undefined) {
    this.prune();
    if (!value || !/^[a-f0-9]{64}$/.test(value) || !this.sessions.has(value))
      throw new Error("Pair this browser with Code60 again.");
    return value;
  }
  describe(token: string): BrowserSession {
    this.authenticate(token);
    return {
      token,
      controlling: this.controller === token,
      generation: this.generation,
      version: GATEWAY_VERSION,
    };
  }
  assertController(token: string, generation: unknown) {
    this.authenticate(token);
    if (this.controller !== token || String(this.generation) !== String(generation))
      throw new Error("This browser does not control Code60. Take control and retry.");
  }
  takeControl(token: string) {
    this.authenticate(token);
    const previous = this.controller;
    if (previous !== token) {
      this.controller = token;
      this.generation++;
    }
    return { previous, session: this.describe(token) };
  }
  get controlling() {
    return this.controller;
  }
}
