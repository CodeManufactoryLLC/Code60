import {
  decodeMcpText,
  MCP_EMPTY_TEXT,
  type McpTextRead,
  validateMcpConnectorText,
} from "../bridge/index.js";
export interface McpDraft {
  saved: McpTextRead;
  latest: McpTextRead;
  text: string;
  savedText: string;
  ownerLost: boolean;
  hold: boolean;
}
export const sameMcpOwner = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function newMcpDraft(saved: McpTextRead): McpDraft {
  const text =
    saved.contentBase64 === null
      ? saved.exists
        ? ""
        : MCP_EMPTY_TEXT
      : decodeMcpText(saved.contentBase64);
  return { saved, latest: saved, text, savedText: text, ownerLost: false, hold: false };
}
export function observeMcpDraft(draft: McpDraft, latest: McpTextRead): McpDraft {
  if (!sameMcpOwner(draft.saved.target, latest.target)) return { ...draft, ownerLost: true };
  if (draft.ownerLost || draft.hold || draft.text !== draft.savedText) return { ...draft, latest };
  return newMcpDraft(latest);
}
export function mcpDraftState(draft: McpDraft) {
  const validation = validateMcpConnectorText(draft.text);
  const dirty = draft.text !== draft.savedText;
  const editable = !draft.saved.exists || draft.saved.contentBase64 !== null;
  const stale = draft.ownerLost || draft.latest.revision !== draft.saved.revision;
  const blocked = draft.latest.pendingRecovery.length > 0;
  return {
    validation,
    dirty,
    editable,
    stale,
    blocked,
    canSave: dirty && editable && validation.valid && !stale && !blocked,
  };
}
