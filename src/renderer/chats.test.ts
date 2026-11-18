import { expect, it } from "vitest";
import type { DesktopRun, OrchestrationChat } from "../bridge/index.js";
import { builtinRelayId, hasConversationRun, isSelectedConversation } from "./chats.js";

const relay = { kind: "relay", directory: null, conversationId: "relay" } as OrchestrationChat;
const a = { ...relay, customAgentId: "a", conversationId: "a-chat" };
const b = { ...relay, customAgentId: "b", conversationId: "b-chat" };
it("persists read state only for a run identity, not an application's startup address", () => {
  expect(hasConversationRun([relay], [], undefined)).toBe(false);
  expect(hasConversationRun([relay], [], relay.conversationId)).toBe(false);
  const live = { ...relay, run: { id: "relay-run" } } as OrchestrationChat;
  expect(hasConversationRun([live], [], "relay-run")).toBe(true);
  expect(hasConversationRun([live], [], relay.conversationId)).toBe(false);
  const worker = { record: { id: "worker" } } as DesktopRun;
  expect(hasConversationRun([live], [worker], "worker")).toBe(true);
  expect(hasConversationRun([live], [worker], "missing")).toBe(false);
});
it("enables Relay navigation only after the built-in owner has an address", () => {
  expect(builtinRelayId([])).toBeUndefined();
  expect(builtinRelayId([a, b])).toBeUndefined();
  const { conversationId: _, ...disconnected } = relay;
  expect(builtinRelayId([disconnected, a])).toBeUndefined();
  expect(builtinRelayId([a, relay, b])).toBe("relay");
});
it.each([relay, a, b])("activates only the selected application conversation", (selected) => {
  expect([relay, a, b].filter((chat) => isSelectedConversation(chat, selected))).toEqual([
    selected,
  ]);
});
it("keeps disconnected application owners separate and preserves project path selection", () => {
  const { conversationId: aId, ...disconnectedA } = a;
  const { conversationId: bId, ...disconnectedB } = b;
  expect(aId).not.toBe(bId);
  expect(isSelectedConversation(disconnectedA, disconnectedB)).toBe(false);
  const project = { kind: "project", directory: "/repo" } as OrchestrationChat;
  expect(isSelectedConversation(project, { ...project })).toBe(true);
  expect(isSelectedConversation(a, project)).toBe(false);
  expect(isSelectedConversation(project, b)).toBe(false);
  expect(isSelectedConversation({ ...project, directory: "/other" }, project)).toBe(false);
});
