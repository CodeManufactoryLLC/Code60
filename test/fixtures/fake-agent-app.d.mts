import type { AgentApp } from "@agentclientprotocol/sdk";

export function createFakeAgent(options?: { authRequired?: boolean; sessionInfo?: boolean; reviewWorkflow?: boolean }): AgentApp;
