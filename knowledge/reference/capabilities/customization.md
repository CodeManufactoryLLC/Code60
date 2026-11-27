---
id: KB-REF-003
title: "Capabilities: Customization, Memory, and Settings"
domain: reference
kind: reference
status: active
summary: Generated capability specs for Commands, Tactics, Internal Prompts, Configurations, model defaults, Memory, handoff, and Settings.
updated: 2026-11-27
code_refs:
  - src/contracts/knowledge.ts
  - src/contracts/navigation.ts
tags:
  - capabilities
  - customization
  - settings
  - reference
---

# Capabilities: Customization, Memory, and Settings

Generated from `src/contracts/knowledge.ts`. Do not edit by hand; run `npm run generate:capabilities`.

Schema version: 1

## Commands

- ID: `commands`
- Status: shipped
- Purpose: Use bundled or saved reusable prompts with a leading $name. Bundled commands: $create-command: Create a reusable $ command from your instructions. $plan: Propose a plan for your request and wait for Code60 acceptance. $business-evaluation: Plan an evidence-based business evaluation, then wait for Code60 acceptance. $catch-me-up: Explain the broader context and anything I may have missed. $big-picture: Step back from the details and reassess the value and approach. $pushback: Challenge your conclusion and re-evaluate the evidence. $simplify: Explain the current topic in simple, plain language.
- Access: Context → Commands (also Apps → Commands); project composer / or $ command picker
- Prerequisite: database
- Agent access: existing-tools
- Confirmation: Existing permissions apply.
- Limits: Choose a slash suggestion to insert its $name token, then add arguments. An unselected /name is plain text. Saved names override bundled names. Commands expand only in project orchestrator chats, not Relay or worker chats. Conversation commands do not grant new execution authority. Relay has no command creation tool; reading never executes.
- Pages: `commands`
- Settings sections: none
- Tools: `code60_create_command`

## Tactics

- ID: `tactics`
- Status: shipped
- Purpose: Select a bundled workflow for a project request.
- Access: Project chat composer → Tactics
- Prerequisite: database
- Agent access: read
- Confirmation: Existing permissions apply.
- Limits: Selection does not send; role and iteration instructions are not runtime guarantees.
- Pages: none
- Settings sections: none
- Tools: none

## Internal Prompts

- ID: `prompts`
- Status: shipped
- Purpose: Inspect all 44 internal prompts by canonical dotted ID and customize the 10 editable project, handoff, and utility templates.
- Access: Context → Internal Prompts (also Apps → Internal Prompts) → filter by ID/name and Save, Discard changes, or Reset to default
- Prerequisite: database
- Agent access: read
- Confirmation: Existing permissions apply.
- Limits: Database overrides precede config and built-ins for the 10 editable templates. Safety wrappers, strict JSON schemas, bundled tactics, built-in commands, and Relay/Custom Assistant prompts are read-only; Relay stays independent of project databases.
- Pages: `prompts`
- Settings sections: none
- Tools: none

## Saved configurations

- ID: `configurations`
- Status: shipped
- Purpose: Reuse saved run settings.
- Access: Apps → Data Viewer → Configurations
- Prerequisite: database
- Agent access: read
- Confirmation: Existing permissions apply.
- Limits: Saved settings are not live provider health.
- Pages: `configurations`
- Settings sections: none
- Tools: `code60_read_configurations`, `code60_search_configurations`

## Model and reasoning

- ID: `model-settings`
- Status: shipped
- Purpose: Switch connector-advertised model and reasoning settings between turns and save confirmed role defaults for new sessions.
- Access: Chat or worker composer → Model; Connect → Providers → Clear beside a saved model default
- Prerequisite: provider
- Agent access: human-only
- Confirmation: Human selection only; no model-switching MCP tool. Main derives saved values from the owned session.
- Limits: Idle connected sessions only; choices depend on the connector. Busy: Available after this turn; ended: Last reported; timeout: Model unconfirmed. Defaults apply only to new sessions, model first; unavailable values produce notes, never substitutes. Orchestrator covers Relay, project chats and Custom Assistants. Workers do not follow parent changes. No changes to helpers, automation or resumed sessions.
- Pages: none
- Settings sections: none
- Tools: none

## Memory

- ID: `memory`
- Status: shipped
- Purpose: Learn and recall scoped evidence when enabled.
- Access: Context → Memory (also Apps → Memory); Apps → Data Viewer → Memories
- Prerequisite: none
- Agent access: human-only
- Confirmation: Existing permissions apply.
- Limits: Memory Off disables learning/recall, not session-local continuity. No memory records exposed through awareness.
- Pages: `memories`
- Settings sections: `memory`
- Tools: none

## Context handoff

- ID: `continuity`
- Status: shipped
- Purpose: Maintain bounded session continuity between turns.
- Access: Automatic between-turn application lifecycle
- Prerequisite: provider
- Agent access: read
- Confirmation: Existing permissions apply.
- Limits: Never restores permissions or replays dispatched work; independent of Memory On/Off.
- Pages: none
- Settings sections: none
- Tools: none

## Settings

- ID: `settings`
- Status: shipped
- Purpose: Choose Light, Dark or System, interface text size, signal colors and table defaults. Table defaults start at Low density (Carbon 64px rows), with row, column and heading lines off. Saved table settings retain their column order, visibility and density. Apply saves the draft, including a Reset to defaults. Cancel or Escape discards it. Browser-native window management is outside Code60.
- Access: Personalize → Text, Table Defaults or Appearance, Manage → About or Polling, Workspace → Color theme
- Prerequisite: none
- Agent access: human-only
- Confirmation: Existing permissions apply.
- Limits: Navigation groups expand or collapse independently. Project and conversation disclosures retain their own state. System follows the operating system. In Appearance, use the Accent color picker to change the default verdigris or reset it. This browser remembers the accent across light and dark themes. Legacy decorative preferences remain stored.
- Pages: `apps`, `advanced`, `experiments`, `settings`
- Settings sections: `appearance`, `table-defaults`, `text`, `polling-settings`, `about`
- Tools: none
