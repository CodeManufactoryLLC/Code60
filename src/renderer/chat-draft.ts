import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { ChatReference, OrchestrationChat } from "../bridge/index.js";
import { chatReferenceSchema } from "../bridge/index.js";
import { ScopeLifetime } from "./scope-lifetime.js";

export interface ChatAttachment {
  reference: ChatReference;
  label: string;
}
const drafts = new Map<string, ChatDraft>();
export const relayDraftKey = "code60.orchestrationDraft:relay";
export function chatDraftKey(chat: OrchestrationChat | undefined): string {
  if (chat?.kind === "relay") return relayDraftKey;
  const id = chat?.conversationId ?? chat?.run?.id;
  return id ? `code60.orchestrationDraft:${id}` : "";
}
export function attachToChat(key: string, attachment: ChatAttachment): boolean {
  return drafts.get(key)?.attach(attachment) ?? false;
}
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
interface DraftSnapshot {
  text: string;
  storageError: string;
  attachments: readonly ChatAttachment[];
}
interface SentDraft {
  text: string;
  attachments: readonly ChatAttachment[];
  revision: number;
  current: () => boolean;
}

/** Only draft mechanics are shared. Sending/recovery stays in each chat controller. */
export class ChatDraft extends ScopeLifetime {
  private state: DraftSnapshot = { text: "", storageError: "", attachments: [] };
  private revision = 0;
  private listeners = new Set<() => void>();
  constructor(
    private key: string,
    private storage?: DraftStorage,
  ) {
    super(key);
    try {
      this.state = { ...this.state, text: key ? (storage?.getItem(key) ?? "") : "" };
      const saved = key ? storage?.getItem(`${key}:references`) : null;
      if (saved) {
        if (saved.length > 147_456) throw new Error("Saved references exceed their limit");
        const values: unknown = JSON.parse(saved);
        if (!Array.isArray(values) || values.length > 8)
          throw new Error("Invalid saved references");
        const attachments = values.map((value: unknown): ChatAttachment => {
          if (
            !value ||
            typeof value !== "object" ||
            !("reference" in value) ||
            !("label" in value) ||
            typeof value.label !== "string" ||
            value.label.length > 8192
          )
            throw new Error("Invalid saved reference");
          return { reference: chatReferenceSchema.parse(value.reference), label: value.label };
        });
        this.state = { ...this.state, attachments };
      }
    } catch {
      this.warn();
    }
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: DraftSnapshot) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  private warn() {
    this.publish({
      ...this.state,
      storageError: "Draft could not be saved for reload. Keep this chat open or copy your draft.",
    });
  }
  private persist() {
    try {
      if (!this.key) return;
      this.storage?.setItem(this.key, this.state.text);
      if (this.state.attachments.length)
        this.storage?.setItem(`${this.key}:references`, JSON.stringify(this.state.attachments));
      else this.storage?.removeItem(`${this.key}:references`);
    } catch {
      this.warn();
    }
  }
  edit = (text: string) => {
    if (!this.capture()()) return;
    this.revision++;
    this.publish({ ...this.state, text, storageError: "" });
    this.persist();
  };
  sent = (): SentDraft => ({
    text: this.state.text,
    attachments: this.state.attachments,
    revision: this.revision,
    current: this.capture(),
  });
  clear = (sent: SentDraft) => {
    if (!sent.current() || this.revision !== sent.revision || this.state.text !== sent.text) return;
    this.publish({ text: "", storageError: "", attachments: [] });
    try {
      if (this.key && this.storage?.getItem(this.key) === sent.text)
        this.storage.removeItem(this.key);
      if (
        this.key &&
        this.storage?.getItem(`${this.key}:references`) === JSON.stringify(sent.attachments)
      )
        this.storage.removeItem(`${this.key}:references`);
    } catch {
      this.warn();
    }
  };
  attach = (attachment: ChatAttachment): boolean => {
    if (!this.capture()()) return false;
    if (
      this.state.attachments.some(
        (item) => JSON.stringify(item.reference) === JSON.stringify(attachment.reference),
      )
    )
      return true;
    if (this.state.attachments.length >= 8) return false;
    this.revision++;
    this.publish({ ...this.state, attachments: [...this.state.attachments, attachment] });
    this.persist();
    return true;
  };
  remove = (index: number) => {
    if (!this.capture()()) return;
    this.revision++;
    this.publish({
      ...this.state,
      attachments: this.state.attachments.filter((_, at) => at !== index),
    });
    this.persist();
  };
  restore = (sent: SentDraft, text: string, references: readonly ChatReference[] = []): boolean => {
    if (!sent.current() || sent.revision !== this.revision) return false;
    this.edit(text);
    this.publish({
      ...this.state,
      attachments: references.map((reference) => ({
        reference,
        label: `Saved code${reference.side ? ` (${reference.side})` : ""}${reference.start ? ` · lines ${reference.start}-${reference.end}` : ""}`,
      })),
    });
    this.persist();
    return true;
  };
}
export function useChatDraft(key: string, runId?: string, conversationId?: string) {
  const store = useMemo(() => {
    let storage: Storage | undefined;
    try {
      storage = typeof sessionStorage === "undefined" ? undefined : sessionStorage;
    } catch {}
    return new ChatDraft(key, storage);
  }, [key]);
  useEffect(() => {
    store.activate();
    if (key) drafts.set(key, store);
    return () => {
      if (drafts.get(key) === store) drafts.delete(key);
      store.dispose();
    };
  }, [store, key]);
  useEffect(() => {
    if (!runId) return;
    const alias = `code60.orchestrationDraft:${runId}`;
    if (alias === key) return;
    drafts.set(alias, store);
    return () => {
      if (drafts.get(alias) === store) drafts.delete(alias);
    };
  }, [key, runId, store]);
  useEffect(() => {
    if (!conversationId) return;
    const alias = `code60.orchestrationDraft:${conversationId}`;
    if (alias === key) return;
    drafts.set(alias, store);
    return () => {
      if (drafts.get(alias) === store) drafts.delete(alias);
    };
  }, [conversationId, key, store]);
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  return {
    draft: state.text,
    storageError: state.storageError,
    attachments: state.attachments,
    remove: store.remove,
    restore: store.restore,
    edit: store.edit,
    sent: store.sent,
    clear: store.clear,
  };
}
