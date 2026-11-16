import { describe, expect, it, vi } from "vitest";
import { ChatDraft } from "./chat-draft.js";

const attachment = {
  reference: {
    reviewId: "b6555384-79d3-4e54-98ba-a1b262c1a6d1",
    revisionId: "73810d58-9e5c-4ad7-af25-930a42df1330",
    fileKey: "opaque",
    side: "modified" as const,
    start: 2,
    end: 4,
  },
  label: "file.ts:2-4 (modified)",
};

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
  it("keeps pinned code references across reload and removes them only after a matching Send", () => {
    const saved = storage();
    const draft = new ChatDraft("key", saved);
    draft.edit("Keep my correction.");
    draft.attach(attachment);
    const loaded = new ChatDraft("key", saved);
    expect(loaded.snapshot()).toMatchObject({
      text: "Keep my correction.",
      attachments: [attachment],
    });
    loaded.clear(loaded.sent());
    expect(new ChatDraft("key", saved).snapshot()).toMatchObject({ text: "", attachments: [] });
  });
  it("preserves source text but rejects malformed saved references", () => {
    const saved = storage();
    saved.setItem("key", "Keep this.");
    saved.setItem(
      "key:references",
      JSON.stringify([{ ...attachment, reference: { ...attachment.reference, end: 1 } }]),
    );
    const draft = new ChatDraft("key", saved);
    expect(draft.snapshot()).toMatchObject({ text: "Keep this.", attachments: [] });
    expect(draft.snapshot().storageError).toContain("could not be saved");
  });
  it("adds and removes exact references without replacing or sending a draft", () => {
    const draft = new ChatDraft("key", storage());
    draft.edit("Please adjust this.");
    expect(draft.attach(attachment)).toBe(true);
    expect(draft.attach(attachment)).toBe(true);
    expect(draft.sent()).toMatchObject({ text: "Please adjust this.", attachments: [attachment] });
    const sent = draft.sent();
    draft.remove(0);
    draft.clear(sent);
    expect(draft.snapshot().text).toBe("Please adjust this.");
    expect(draft.snapshot().attachments).toEqual([]);
  });
  it("restores the original request only to the confirmed draft version, never resending", () => {
    const saved = storage();
    const draft = new ChatDraft("key", saved);
    draft.edit("unsent");
    draft.attach(attachment);
    expect(draft.restore(draft.sent(), "Original request")).toBe(true);
    expect(draft.snapshot()).toMatchObject({ text: "Original request", attachments: [] });
    expect(saved.getItem("key")).toBe("Original request");
    const sent = draft.sent();
    draft.edit("newer");
    expect(draft.restore(sent, "stale")).toBe(false);
    expect(draft.snapshot().text).toBe("newer");
  });
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
  it("returns original exact code references with the request and preserves newer attachments", () => {
    const saved = storage();
    const draft = new ChatDraft("key", saved);
    expect(draft.restore(draft.sent(), "Original correction", [attachment.reference])).toBe(true);
    expect(draft.snapshot().attachments[0]?.reference).toEqual(attachment.reference);
    expect(new ChatDraft("key", saved).snapshot().attachments).toEqual(
      draft.snapshot().attachments,
    );
    const sent = draft.sent();
    draft.attach({ ...attachment, reference: { ...attachment.reference, start: 1 } });
    expect(draft.restore(sent, "Stale", [])).toBe(false);
    expect(draft.snapshot().attachments).toHaveLength(2);
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
