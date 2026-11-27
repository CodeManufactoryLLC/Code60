---
id: KB-REF-001
title: "Capabilities: Orchestration and Chat"
domain: reference
kind: reference
status: active
summary: Generated capability specs for Relay, Assistants, Custom Assistants, Projects, Workers, auto-approval, and activity display.
updated: 2026-11-27
code_refs:
  - src/contracts/knowledge.ts
  - src/contracts/navigation.ts
tags:
  - capabilities
  - orchestration
  - chat
  - reference
---

# Capabilities: Orchestration and Chat

Generated from `src/contracts/knowledge.ts`. Do not edit by hand; run `npm run generate:capabilities`.

Schema version: 1

## Relay

- ID: `relay`
- Status: shipped
- Purpose: Application-wide orchestration across explicit targets. Select the relay animation checkbox beside Forward to show the dot above Chat. It defaults to off and remembers your choice in this browser. The dot shows Relay activity across pages: Idle, Listening, Thinking, Speaking, Complete or Attention. The embedded Carbon prompt line opens the selected Code60 thread. Enter sends and Shift+Enter adds a line. Stop targets the current turn.
- Access: Sidebar → Chat (also available from Home and Chat History)
- Prerequisite: provider
- Agent access: existing-tools
- Confirmation: Existing permissions apply.
- Limits: Requires explicit target and direct/worktree mode; selection and history grant no authority.
- Pages: none
- Settings sections: none
- Tools: none

## Assistants

- ID: `assistants`
- Status: shipped
- Purpose: Open Relay or Custom Assistants from two destination rows on the Assistants page.
- Access: Commands → Assistants
- Prerequisite: none
- Agent access: human-only
- Confirmation: Existing permissions apply.
- Limits: Available without a database. Opening this page does not connect a provider or start work. The heading navigates independently of the disclosure chevron; Relay availability follows the existing application conversation.
- Pages: `assistants`
- Settings sections: none
- Tools: none

## Custom Assistants

- ID: `custom-agents`
- Status: shipped
- Purpose: Create application-wide assistants with special instructions and one persistent Relay-style conversation each.
- Access: Home → Custom Assistants or Sidebar → Customize → Custom Assistants → New Assistant; assistant row → More actions → Edit or Archive; title actions → Archived → row → More actions → Restore; Chat History
- Prerequisite: none
- Agent access: human-only
- Confirmation: Archiving requires browser confirmation, stops only the assistant and preserves history.
- Limits: Up to 64 assistants, 120-character names and 32,000-character instructions. Shared verified provider required for chat. Independent histories, workspaces, workers and memory scope; no automatic task resumption. Stop the assistant and its workers before editing. Edits refresh provider context on next human Send, preserving history. No management MCP tools.
- Pages: `custom-agents`
- Settings sections: none
- Tools: none

## Projects

- ID: `projects`
- Status: shipped
- Purpose: Retain independent project workspaces and conversations. New Session starts a project-bound chat.
- Access: Chat History → New chat (Open Project Folder, New Session, Close Project) or Commands → Open project
- Prerequisite: database
- Agent access: read
- Confirmation: Select database offers Open existing database and Create database. Each opens its host picker immediately. The authenticated host folder chooser allows directory creation within locally configured roots. Click to select a folder, double-click or press Enter to browse, then choose the folder. Confirm the full selected path with Open project. Back, Forward and Up navigate the chooser. Cancel has initial focus on confirmation and leaves the current project and history unchanged. Close Project requires the existing Stop folder confirmation; cancelling leaves work running.
- Limits: Opening or selecting a project is a human action; opening never initializes Git. Archiving the last displayed project chat returns to Relay without creating a replacement. New Session explicitly creates a chat. Project chat auto-names are limited to 19 characters. Manual names and existing titles are unchanged. Close Project invokes Stop Folder: it stops project work and Relay workers in that folder, pauses replacement for that task/target and keeps the project open. Other folders continue. Relay, Custom Assistant chats, project chats, and workers are listed in Carbon's Chat History panel beside the navigation sidebar.
- Pages: `chat`
- Settings sections: none
- Tools: none

## Workers

- ID: `workers`
- Status: shipped
- Purpose: Delegate and follow up with owned coding agents.
- Access: Chat and existing worker tools
- Prerequisite: capacity
- Agent access: existing-tools
- Confirmation: Existing permissions apply.
- Limits: Project workers require Git isolation with an initial commit; project orchestrators can inspect and initialize Git through code60_setup_git. Idle workers consume capacity.
- Pages: none
- Settings sections: none
- Tools: `code60_get_context`, `code60_setup_git`, `code60_dispatch_agent`, `code60_list_agents`, `code60_read_agent`, `code60_send_agent`, `code60_cancel_agent`, `code60_finish_agent`, `code60_stop_agent`, `code60_resume_agent`

## Code60 auto-approval

- ID: `orchestration-permissions`
- Status: shipped
- Purpose: Choose whether to review each permission request from Relay, Custom Assistants, project chats and their workers.
- Access: Workspace header → auto-approve
- Prerequisite: none
- Agent access: human-only
- Confirmation: When off, choose Allow once or Deny in the requesting conversation. The Workspace approval count opens a waiting conversation, including archived project chats with a pending request.
- Limits: Defaults on. Changes apply to new ACP requests in live and future sessions. Pending requests still need an answer. Manual runs and scheduled automations have separate policies.
- Pages: none
- Settings sections: none
- Tools: none

## Activity display

- ID: `activity`
- Status: shipped
- Purpose: Show the orchestrator's current step beside the transcript and spotlight working conversation and worker names, including custom assistants and Relay.
- Access: Chat transcript activity line and left navigation names
- Prerequisite: runtime
- Agent access: existing-tools
- Confirmation: Existing permissions apply.
- Limits: Presentation only; reports never change work or permissions. Sidebar names follow live connection, work and worker-monitoring states; approval, stopping, idle and saved entries stay static. Hidden views, reduced motion and forced colors disable the spotlight.
- Pages: none
- Settings sections: none
- Tools: `code60_get_activity_context`, `code60_report_activity`
