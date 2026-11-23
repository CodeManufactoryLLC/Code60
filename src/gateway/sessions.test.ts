import { describe, expect, it } from "vitest";
import { Sessions } from "./sessions.js";

describe("browser session authority", () => {
  it("consumes pairing once, requires explicit takeover and invalidates the previous generation", () => {
    const sessions = new Sessions();
    const code = sessions.proof();
    const first = sessions.pair(code);
    expect(() => sessions.pair(code)).toThrow("invalid or expired");
    const second = sessions.pair(sessions.proof());
    expect(first.controlling).toBe(true);
    expect(second.controlling).toBe(false);
    expect(() => sessions.assertController(second.token, second.generation)).toThrow(
      "does not control",
    );
    const next = sessions.takeControl(second.token);
    expect(next.previous).toBe(first.token);
    expect(() => sessions.assertController(first.token, first.generation)).toThrow(
      "does not control",
    );
    sessions.assertController(second.token, next.session.generation);
  });
  it("expires proofs and sessions without restoring authority", () => {
    let time = 0;
    const sessions = new Sessions(() => time);
    const proof = sessions.proof();
    time += 60_001;
    expect(() => sessions.pair(proof)).toThrow();
    const session = sessions.pair(sessions.proof());
    time += 12 * 60 * 60_000;
    expect(() => sessions.authenticate(session.token)).toThrow("Pair this browser");
    expect(sessions.pair(sessions.proof()).generation).toBeGreaterThan(session.generation);
  });
});
