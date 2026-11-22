import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { automationClient, subscribeService } from "../automation/index.js";
import { DesktopAutomations } from "./automations.js";

vi.mock("../automation/index.js", () => ({
  automationClient: vi.fn(),
  automationRoot: () => "/fixture/service",
  subscribeService: vi.fn(async () => () => {}),
  schedulerControl: vi.fn(),
}));

describe("automation deletion warnings", () => {
  const id = randomUUID();
  const client = vi.fn();
  const confirm = vi.fn();
  let service: DesktopAutomations;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(automationClient).mockReturnValue(client);
    client.mockReset().mockResolvedValue({
      id,
      revision: 3,
      name: "Nightly checks",
      repository: { path: "/fixture/repo" },
    });
    confirm.mockReset().mockResolvedValue(false);
    service = new DesktopAutomations(
      {},
      { pick: async () => null, confirm },
      () => {},
      () => [],
    );
  });

  it("names the saved target and consequences; cancellation leaves the schedule intact", async () => {
    expect(await service.request({ action: "delete", id, revision: 3 })).toBeNull();
    expect(confirm).toHaveBeenCalledExactlyOnceWith(
      "Delete automation?",
      expect.stringContaining("Nightly checks” in /fixture/repo"),
    );
    expect(confirm.mock.calls[0]?.[1]).toContain("saved schedule and prompt and cannot be undone");
    expect(client).toHaveBeenCalledExactlyOnceWith({ action: "get", id });
    expect(subscribeService).not.toHaveBeenCalled();
  });

  it("executes only the displayed revision after confirmation", async () => {
    confirm.mockResolvedValue(true);
    await service.request({ action: "delete", id, revision: 3 });
    expect(client.mock.calls).toEqual([
      [{ action: "get", id }],
      [{ action: "delete", id, revision: 3 }],
    ]);
    service.reset();
  });

  it("requires review again if the schedule changed before the warning", async () => {
    await expect(service.request({ action: "delete", id, revision: 2 })).rejects.toThrow("changed");
    expect(confirm).not.toHaveBeenCalled();
    expect(client).toHaveBeenCalledTimes(1);
  });

  it("rejects a delayed approval after renderer replacement", async () => {
    let answer!: (value: boolean) => void;
    confirm.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    );
    const pending = service.request({ action: "delete", id, revision: 3 });
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    service.reset();
    answer(true);
    await expect(pending).rejects.toThrow("view was replaced");
    expect(client).toHaveBeenCalledTimes(1);
  });

  it("surfaces a deletion conflict instead of retrying with newer parameters", async () => {
    confirm.mockResolvedValue(true);
    client
      .mockResolvedValueOnce({
        id,
        revision: 3,
        name: "Nightly checks",
        repository: { path: "/fixture/repo" },
      })
      .mockRejectedValueOnce(new Error("revision conflict"));
    await expect(service.request({ action: "delete", id, revision: 3 })).rejects.toThrow(
      "revision conflict",
    );
    expect(client).toHaveBeenCalledTimes(2);
    expect(confirm).toHaveBeenCalledOnce();
  });
});
