import { describe, expect, it, vi } from "vitest";
import { Confirmations } from "./confirmations.js";

const response = (value: number) => ({ response: value, checkboxChecked: false });

describe("window-owned confirmations", () => {
  it("attaches a labelled warning to its owner and defaults keyboard/dismissal to Cancel", async () => {
    const owner = {};
    const show = vi.fn(async () => response(1));
    const warnings = new Confirmations(() => owner, show);
    const action = vi.fn(async () => {});
    expect(
      await warnings.perform("Delete schedule?", "Nightly in /fixture; cannot undo.", action),
    ).toBe(true);
    expect(show).toHaveBeenCalledExactlyOnceWith(owner, {
      type: "warning",
      title: "Delete schedule?",
      message: "Delete schedule?",
      detail: "Nightly in /fixture; cannot undo.",
      buttons: ["Cancel", "Confirm"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    expect(action).toHaveBeenCalledOnce();
  });

  it.each([0, -1, 2])("does not mutate on cancellation or dismissal (%s)", async (value) => {
    const action = vi.fn(async () => {});
    const warnings = new Confirmations(
      () => "window",
      async () => response(value),
    );
    expect(await warnings.perform("Clear logs?", "Retained diagnostics", action)).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });

  it("rejects overlapping targets through the dialog and the entire underlying operation", async () => {
    let answer!: (value: ReturnType<typeof response>) => void;
    let finish!: () => void;
    const show = vi.fn(
      () =>
        new Promise<ReturnType<typeof response>>((resolve) => {
          answer = resolve;
        }),
    );
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const other = vi.fn(async () => {});
    const warnings = new Confirmations(() => "window", show);
    const pending = warnings.perform("Delete A?", "A", action);
    expect(await warnings.perform("Delete B?", "B", other)).toBe(false);
    answer(response(1));
    await vi.waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(await warnings.perform("Delete A?", "A", other)).toBe(false);
    expect(show).toHaveBeenCalledOnce();
    finish();
    expect(await pending).toBe(true);
    expect(other).not.toHaveBeenCalled();
  });

  it.each(["reload", "replace", "close"])("rejects a late approval after %s", async (change) => {
    let owner: string | undefined = "original";
    let answer!: (value: ReturnType<typeof response>) => void;
    const warnings = new Confirmations(
      () => owner,
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const action = vi.fn(async () => {});
    const pending = warnings.perform("Clear logs?", "Retained diagnostics", action);
    if (change === "reload") warnings.invalidate();
    else owner = change === "replace" ? "replacement" : undefined;
    answer(response(1));
    expect(await pending).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });

  it("needs a live window and never reuses a failed dialog or operation's approval", async () => {
    let owner: string | undefined;
    const show = vi.fn(async () => response(1));
    const warnings = new Confirmations(() => owner, show);
    expect(await warnings.confirm("Delete?", "target")).toBe(false);
    expect(show).not.toHaveBeenCalled();
    owner = "window";
    show.mockRejectedValueOnce(new Error("dialog failed"));
    await expect(warnings.confirm("Delete?", "target")).rejects.toThrow("dialog failed");
    await expect(
      warnings.perform("Delete?", "target", async () => {
        throw new Error("write failed");
      }),
    ).rejects.toThrow("write failed");
    expect(await warnings.confirm("Stop?", "target", "Stop all")).toBe(true);
    expect(show).toHaveBeenCalledTimes(3);
    expect(show.mock.calls.at(-1)).toEqual([
      owner,
      expect.objectContaining({ buttons: ["Cancel", "Stop all"] }),
    ]);
  });
});
