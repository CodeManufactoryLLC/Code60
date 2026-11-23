import { expect, it } from "vitest";
import { encodeMcpText, MCP_EMPTY_TEXT, type McpTextRead } from "../bridge/index.js";
import { mcpDraftState, newMcpDraft, observeMcpDraft } from "./mcp-draft.js";

const saved: McpTextRead = {
  target: { scope: "user", targetId: "a".repeat(64) },
  revision: "b".repeat(64),
  exists: true,
  contentBase64: encodeMcpText(MCP_EMPTY_TEXT),
  issues: [],
  pendingRecovery: [],
};
it("retains dirty text on external revisions, invalidates Save and permits comparison with the newer saved bytes", () => {
  const draft = { ...newMcpDraft(saved), text: MCP_EMPTY_TEXT + " " };
  expect(mcpDraftState(draft).canSave).toBe(true);
  const updated = observeMcpDraft(draft, {
    ...saved,
    revision: "c".repeat(64),
    contentBase64: encodeMcpText(MCP_EMPTY_TEXT + "\n"),
  });
  expect(updated.text).toBe(draft.text);
  expect(updated.saved.revision).toBe(saved.revision);
  expect(mcpDraftState(updated)).toMatchObject({ dirty: true, stale: true, canSave: false });
});
it("retains even clean held drafts after uncertain mutation, and never revives a replacement owner", () => {
  const draft = { ...newMcpDraft(saved), hold: true };
  expect(observeMcpDraft(draft, { ...saved, revision: "c".repeat(64) }).saved.revision).toBe(
    saved.revision,
  );
  const stale = observeMcpDraft(draft, {
    ...saved,
    target: {
      scope: "project",
      targetId: "a".repeat(64),
      projectId: "11111111-1111-4111-8111-111111111111",
      databaseEpoch: 1,
    },
  });
  expect(stale.ownerLost).toBe(true);
  expect(mcpDraftState(stale).canSave).toBe(false);
});
it("distinguishes absence, malformed text, invalid encoding and pending evidence", () => {
  expect(newMcpDraft({ ...saved, exists: false, contentBase64: null }).text).toBe(MCP_EMPTY_TEXT);
  expect(
    mcpDraftState(newMcpDraft({ ...saved, contentBase64: encodeMcpText("malformed") })).validation
      .valid,
  ).toBe(false);
  expect(mcpDraftState(newMcpDraft({ ...saved, contentBase64: null })).editable).toBe(false);
  expect(
    mcpDraftState({
      ...newMcpDraft({ ...saved, pendingRecovery: ["pending"] }),
      text: MCP_EMPTY_TEXT + " ",
    }),
  ).toMatchObject({ blocked: true, canSave: false });
  expect(
    observeMcpDraft(newMcpDraft(saved), { ...saved, revision: "c".repeat(64) }).saved.revision,
  ).toBe("c".repeat(64));
});
