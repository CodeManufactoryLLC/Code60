import { useEffect, useMemo, useSyncExternalStore } from "react";
import { ScopeLifetime } from "./scope-lifetime.js";

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
interface DraftSnapshot {
  text: string;
  storageError: string;
}
interface SentDraft {
  text: string;
  revision: number;
  current: () => boolean;
}

/** Only draft mechanics are shared. Sending/recovery stays in each chat controller. */
export class ChatDraft extends ScopeLifetime {
  private state: DraftSnapshot = { text: "", storageError: "" };
  private revision = 0;
  private listeners = new Set<() => void>();
  constructor(
    private key: string,
    private storage?: DraftStorage,
  ) {
    super(key);
    try {
      this.state = { text: key ? (storage?.getItem(key) ?? "") : "", storageError: "" };
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
  edit = (text: string) => {
    if (!this.capture()()) return;
    this.revision++;
    this.publish({ text, storageError: "" });
    try {
      if (this.key) this.storage?.setItem(this.key, text);
    } catch {
      this.warn();
    }
  };
  sent = (): SentDraft => ({
    text: this.state.text,
    revision: this.revision,
    current: this.capture(),
  });
  clear = (sent: SentDraft) => {
    if (!sent.current() || this.revision !== sent.revision || this.state.text !== sent.text) return;
    this.publish({ text: "", storageError: "" });
    try {
      if (this.key && this.storage?.getItem(this.key) === sent.text)
        this.storage.removeItem(this.key);
    } catch {
      this.warn();
    }
  };
}
export function useChatDraft(key: string) {
  const store = useMemo(() => {
    let storage: Storage | undefined;
    try {
      storage = typeof sessionStorage === "undefined" ? undefined : sessionStorage;
    } catch {}
    return new ChatDraft(key, storage);
  }, [key]);
  useEffect(() => {
    store.activate();
    return () => store.dispose();
  }, [store]);
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  return {
    draft: state.text,
    storageError: state.storageError,
    edit: store.edit,
    sent: store.sent,
    clear: store.clear,
  };
}
