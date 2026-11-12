import { describe, expect, it, vi } from "vitest";
import { ChatDraft } from "./chat-draft.js";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
describe("conversation drafts", () => {
  it("retains exact source, uses existing per-role keys, and clears only a successful sent version", () => {
    const saved = storage();
    const orchestrator = new ChatDraft("code60.orchestrationDraft:a", saved);
    const worker = new ChatDraft("code60.workerDraft:a", saved);
    const off = orchestrator.subscribe(vi.fn());
    orchestrator.edit("  hello\n\n");
    worker.edit("worker");
    const sent = orchestrator.sent();
    expect(sent.text).toBe("  hello\n\n");
    expect(new ChatDraft("code60.orchestrationDraft:a", saved).snapshot().text).toBe(sent.text);
    orchestrator.clear(sent);
    expect(orchestrator.snapshot().text).toBe("");
    expect(saved.getItem("code60.orchestrationDraft:a")).toBeNull();
    expect(worker.snapshot().text).toBe("worker");
    off();
  });
  it("does not clear later edits, even if they return to the submitted text", () => {
    const draft = new ChatDraft("key", storage());
    draft.edit("sent");
    const sent = draft.sent();
    draft.edit("later");
    draft.edit("sent");
    draft.clear(sent);
    expect(draft.snapshot().text).toBe("sent");
  });
  it("rejects completion from a disposed instance without erasing persisted or replacement drafts", () => {
    const saved = storage();
    const old = new ChatDraft("key", saved);
    old.edit("old");
    const sent = old.sent();
    old.dispose();
    const replacement = new ChatDraft("key", saved);
    replacement.edit("replacement");
    old.clear(sent);
    old.edit("late");
    expect(saved.getItem("key")).toBe("replacement");
    old.activate();
    old.clear(sent);
    expect(old.snapshot().text).toBe("old");
  });
  it("keeps the live draft and reports storage failure without failing Send", () => {
    const unavailable = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const draft = new ChatDraft("key", unavailable);
    expect(draft.snapshot().storageError).toContain("copy your draft");
    draft.edit("keep");
    expect(draft.snapshot().text).toBe("keep");
    draft.clear(draft.sent());
    expect(draft.snapshot().text).toBe("");
    expect(draft.snapshot().storageError).not.toBe("");
  });
  it("does not touch storage without an identity or erase another writer's saved text", () => {
    const saved = storage();
    const remove = vi.spyOn(saved, "removeItem");
    const anonymous = new ChatDraft("", saved);
    anonymous.edit("temporary");
    anonymous.clear(anonymous.sent());
    expect(remove).not.toHaveBeenCalled();
    const draft = new ChatDraft("key", saved);
    draft.edit("sent");
    const sent = draft.sent();
    saved.setItem("key", "newer external value");
    draft.clear(sent);
    expect(saved.getItem("key")).toBe("newer external value");
  });
});
