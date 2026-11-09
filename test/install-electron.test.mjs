import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { installElectron } from "../scripts/install-electron.mjs";

const { version } = createRequire(import.meta.url)("electron/package.json");
const filename = `electron-v${version}-${process.platform}-${process.arch}.zip`;
const url = `https://github.com/electron/electron/releases/download/v${version}/${filename}`;
const failure = (message) => ({ status: 1, stderr: message });

describe("Electron download retry", () => {
  it("retries a server error once using the same asset and bundled checksums", () => {
    const run = vi
      .fn()
      .mockReturnValueOnce(failure(`Response code 504 for ${url}`))
      .mockReturnValueOnce({ status: 0 });
    installElectron(run, { electron_use_remote_checksums: "1" }, () => {});
    expect(run).toHaveBeenCalledTimes(2);
    for (const [, , options] of run.mock.calls) {
      expect(options.timeout).toBe(300_000);
      expect(options.env.electron_use_remote_checksums).toBe("");
      expect(options.env.npm_config_electron_use_remote_checksums).toBe("");
    }
    expect(run.mock.calls[1][2].env.ELECTRON_CUSTOM_FILENAME).toBe(`${filename}?download=1`);
  });
  it.each([
    `Response code 404 for ${url}`,
    `Checksum mismatch for ${url}`,
    "Response code 504 for https://example.invalid/asset",
  ])("does not retry %s", (message) => {
    const run = vi.fn().mockReturnValue(failure(message));
    expect(() => installElectron(run, {}, () => {})).toThrow("Electron installation failed");
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("fails after a second server error", () => {
    const run = vi.fn().mockReturnValue(failure(`Response code 504 for ${url}`));
    expect(() => installElectron(run, {}, () => {})).toThrow("Electron installation failed");
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("propagates launch errors without retrying", () => {
    const run = vi.fn().mockReturnValue({ error: new Error("timeout") });
    expect(() => installElectron(run, {}, () => {})).toThrow("timeout");
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("keeps an already installed runtime without retrying", () => {
    const run = vi.fn().mockReturnValue({ status: 0 });
    installElectron(run, {}, () => {});
    expect(run).toHaveBeenCalledTimes(1);
  });
});
