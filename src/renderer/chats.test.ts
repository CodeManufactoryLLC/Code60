import { expect, it } from "vitest";
import type { OrchestrationChat } from "../bridge/index.js";
import { isSelectedConversation } from "./chats.js";

const relay = { kind: "relay", directory: null, conversationId: "relay" } as OrchestrationChat;
const a = { ...relay, customAgentId: "a", conversationId: "a-chat" };
const b = { ...relay, customAgentId: "b", conversationId: "b-chat" };
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
