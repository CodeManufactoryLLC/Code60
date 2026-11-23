import { randomBytes, timingSafeEqual } from "node:crypto";
import { type BrowserSession, GATEWAY_LIMITS, GATEWAY_VERSION } from "../bridge/index.js";

export const sameSecret = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
type Session = { token: string; expires: number; scope: string };

/** Browser tokens are required in both optional and required pairing modes. */
export class Sessions {
  private readonly proofs = new Map<string, { expires: number; scope: string }>();
  private readonly sessions = new Map<string, Session>();
  private controller: string | undefined;
  generation = 0;
  constructor(private readonly now: () => number = Date.now) {}
  private prune() {
    for (const [code, proof] of this.proofs)
      if (proof.expires <= this.now()) this.proofs.delete(code);
    for (const [token, session] of this.sessions)
      if (session.expires <= this.now()) {
        this.sessions.delete(token);
        if (this.controller === token) {
          this.controller = undefined;
          this.generation++;
        }
      }
  }
  proof(scope = "local") {
    this.prune();
    if (this.proofs.size >= GATEWAY_LIMITS.sessions)
      throw new Error("Too many pairing requests. Try again later.");
    const proof = randomBytes(8).toString("hex");
    this.proofs.set(proof, { expires: this.now() + GATEWAY_LIMITS.pairingMs, scope });
    return proof;
  }
  pair(proof: string, scope = "local"): BrowserSession {
    this.prune();
    if (this.proofs.get(proof)?.scope !== scope || this.sessions.size >= GATEWAY_LIMITS.sessions)
      throw new Error("Pairing code is invalid or expired.");
    this.proofs.delete(proof);
    return this.connect(scope);
  }
  connect(scope = "local"): BrowserSession {
    this.prune();
    if (this.sessions.size >= GATEWAY_LIMITS.sessions)
      throw new Error("Too many browser sessions. Try again later.");
    const token = randomBytes(32).toString("hex");
    this.sessions.set(token, { token, expires: this.now() + GATEWAY_LIMITS.sessionMs, scope });
    if (!this.controller) {
      this.controller = token;
      this.generation++;
    }
    return this.describe(token, scope);
  }
  reset() {
    this.proofs.clear();
    this.sessions.clear();
    this.controller = undefined;
    this.generation++;
  }
  authenticate(value: string | undefined, scope = "local") {
    this.prune();
    if (!value || !/^[a-f0-9]{64}$/.test(value) || this.sessions.get(value)?.scope !== scope)
      throw new Error("Pair this browser with Code60 again.");
    return value;
  }
  describe(token: string, scope = "local"): BrowserSession {
    this.authenticate(token, scope);
    return {
      token,
      controlling: this.controller === token,
      generation: this.generation,
      version: GATEWAY_VERSION,
    };
  }
  assertController(token: string, generation: unknown, scope = "local") {
    this.authenticate(token, scope);
    if (this.controller !== token || String(this.generation) !== String(generation))
      throw new Error("This browser does not control Code60. Take control and retry.");
  }
  takeControl(token: string, scope = "local") {
    this.authenticate(token, scope);
    const previous = this.controller;
    if (previous !== token) {
      this.controller = token;
      this.generation++;
    }
    return { previous, session: this.describe(token, scope) };
  }
  tokens(prefix: string): string[] {
    return [...this.sessions]
      .filter(([, session]) => session.scope.startsWith(prefix))
      .map(([token]) => token);
  }
  revoke(prefix: string): string[] {
    for (const [code, proof] of this.proofs)
      if (proof.scope.startsWith(prefix)) this.proofs.delete(code);
    const revoked: string[] = [];
    for (const [token, session] of this.sessions)
      if (session.scope.startsWith(prefix)) {
        revoked.push(token);
        this.sessions.delete(token);
        if (this.controller === token) {
          this.controller = undefined;
          this.generation++;
        }
      }
    return revoked;
  }
  clearProofs(prefix: string) {
    for (const [code, proof] of this.proofs)
      if (proof.scope.startsWith(prefix)) this.proofs.delete(code);
  }
  get controlling() {
    return this.controller;
  }
}
