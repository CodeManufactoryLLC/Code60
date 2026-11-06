import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CODE60_VERSION, RUN_RECORD_FORMAT } from "./version.js";

describe("version", () => {
  it("reads the Code60 version from package.json", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(CODE60_VERSION).toBe(manifest.version);
    expect(CODE60_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("starts the run record format at 1", () => {
    expect(RUN_RECORD_FORMAT).toBe(1);
  });
});
