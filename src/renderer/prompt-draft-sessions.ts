import { useEffect, useRef, useState } from "react";
import type { DesktopApi } from "../bridge/index.js";
import { PromptDraftSession } from "./prompt-editor-model.js";

/** Database replacement never transfers a draft's authority to another database. */
export function usePromptDraftSessions(
  database: string | null | undefined,
  api: DesktopApi,
  setError: (text: string) => void,
) {
  const sessions = useRef(new Map<string, PromptDraftSession>());
  const [, update] = useState(0);
  const key = database ?? "";
  let session = sessions.current.get(key);
  if (!session) {
    session = new PromptDraftSession();
    sessions.current.set(key, session);
  }
  const pending = [...sessions.current.values()].some((entry) => entry.pending);
  const elsewhere = [...sessions.current.entries()].some(
    ([path, entry]) => path !== key && entry.pending,
  );
  useEffect(() => {
    void api
      .setPromptDraftsPending(pending)
      .catch(() =>
        setError(
          "Could not update the unsaved prompt close guard. Keep this window open until drafts are saved or discarded.",
        ),
      );
  }, [api, pending, setError]);
  useEffect(() => {
    if (!pending) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = false;
      setError(
        "Reload blocked: save or discard unsaved Prompt Builder drafts, including drafts retained in other databases, then reload again.",
      );
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [pending, setError]);
  // Changes render the owner too, so the close guard includes drafts in inactive databases.
  return { session, elsewhere, changed: () => update((value) => value + 1) };
}
