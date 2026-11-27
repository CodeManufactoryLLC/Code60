---
id: KB-REF-002
title: "Capabilities: Workspace Navigation and Panels"
domain: reference
kind: reference
status: active
summary: Generated capability specs for navigation, history, Files, Terminal, Memory Recall, Plans, Reviews, and Undo.
updated: 2026-11-27
code_refs:
  - src/contracts/knowledge.ts
  - src/contracts/navigation.ts
tags:
  - capabilities
  - workspace
  - panels
  - reference
---

# Capabilities: Workspace Navigation and Panels

Generated from `src/contracts/knowledge.ts`. Do not edit by hand; run `npm run generate:capabilities`.

Schema version: 1

## Page navigation

- ID: `page-navigation`
- Status: shipped
- Purpose: Open pages through the sidebar, Carbon destination lists or Back and Forward.
- Access: Left navigation sidebar or Home / Apps / Settings lists; workspace header → Back / Forward
- Prerequisite: none
- Agent access: human-only
- Confirmation: No confirmation; navigation only.
- Limits: Chat is a top-level navigation button opening Relay and Carbon's Chat History panel. Automate, Connect, Context, Customize, Personalize, Manage, Contributor Tools and Experiments are expandable navigation groups. Opening a destination reveals its group. Skip to main content moves keyboard focus past the navigation to the current page. Conversations keep their own actions in Chat History. Commands and Workspace are in the header. Returning browsers restore a validated view scoped to the active database, with Relay as the fallback. Restoring a view never sends a request or grants approval.
- Pages: none
- Settings sections: none
- Tools: none

## Back and Forward

- ID: `navigation-history`
- Status: shipped
- Purpose: Return to visited pages, Settings sections, provider home, and specific chats.
- Access: Workspace header → Back / Forward
- Prerequisite: none
- Agent access: human-only
- Confirmation: No confirmation; navigation only.
- Limits: Renderer-memory history holds up to 100 destinations and resets on reload or relaunch. Unavailable destinations are skipped. Buttons are disabled without an available destination or while a selection is pending. Restoring a chat preserves drafts and running work; it never sends a request to an agent.
- Pages: none
- Settings sections: none
- Tools: none

## Files

- ID: `files`
- Status: shipped
- Purpose: Browse files and bounded read-only previews in tabs owned by the individual chat or worker session. Select a tree row with one click. Double-click or press Enter to open a file or toggle a folder; the chevron also toggles it. The Files view dropdown selects among open views; File Explorer, Changes and Memory Recall remain available alongside its + New Tab item. File/document views have Close current tab below the header.
- Access: Chat → upper-right corner of main content card → Toggle files panel
- Prerequisite: runtime
- Agent access: read
- Confirmation: Existing permissions apply.
- Limits: Tab sets, order and selection are independent per session, retained during navigation until project close or renderer reload. Inactive panels release file subscriptions. Archived reviews remain read-only in a reachable panel. The Files view dropdown has no search field. Arrow keys/Home/End and first-letter navigation highlight choices; Enter/Space commits. Delete closes the selected view and Alt+Left/Right reorders it while the closed selector is focused. Tabs cannot be dragged. Closing the final tab leaves the panel open with the selector enabled for the main pages and + New Tab. Close appears only on file/document views, at the upper right below the header. Main-page choices do not load content until selected. Awareness can read only authorized open cached previews from the exact active file subscription, not arbitrary paths.
- Pages: `files`
- Settings sections: none
- Tools: none

## Terminal

- ID: `terminal`
- Status: shipped
- Purpose: Open an interactive shell tab in the right sidebar rooted in the selected agent's worktree or workspace directory.
- Access: Relay, project or worker chat → right sidebar → Open Terminal (or Command Palette → Open terminal)
- Prerequisite: none
- Agent access: human-only
- Confirmation: Human-only; agents cannot open, read, or write interactive terminals.
- Limits: Up to 16 concurrent PTY sessions. Each tab is pinned to the opaque target it was opened for (worker worktree, open project root, or Relay/custom assistant workspace) and keeps its shell and scrollback alive across tab, panel, and page switches. Closing a tab, closing its project, discarding its worktree, or shutting down the backend terminates owned sessions. Awareness exposes tab metadata only, never terminal I/O.
- Pages: none
- Settings sections: none
- Tools: none

## Memory Recall

- ID: `memory-recall`
- Status: shipped
- Purpose: Inspect memories recorded as used by the displayed chat, grouped by dispatched turn.
- Access: Relay, project or worker chat → right sidebar → Files view dropdown → Memory Recall
- Prerequisite: none
- Agent access: human-only
- Confirmation: Read-only; no retrieval or provider dispatch.
- Limits: Database-independent in Relay and its workers. Reads only recorded IDs while visible; current saved records, not historical snapshots. Unavailable records and malformed recall notes are labelled. Editing and forgetting remain in Memories. Awareness exposes tab metadata only, never memory contents.
- Pages: none
- Settings sections: none
- Tools: none

## Plans

- ID: `plans`
- Status: shipped
- Purpose: Propose and track structured, revisioned plans (goal/scope, exclusions, assumptions, ordered tasks with details and verification criteria, rounded completion percentages, and cumulative running time); use View Plan in a blank Files tab to reopen the current conversation’s latest saved plan.
- Access: Chat → right sidebar → + New Tab → View Plan → existing plan tab
- Prerequisite: runtime
- Agent access: existing-tools
- Confirmation: View Plan appears beside Open Files and Open Memory Recall on blank/empty tabs only. It reopens the current session's latest existing plan without generating or accepting one. Human Accept authorizes only that revision and targets. Execution time counts running intervals only; Resume adds to the saved total. Restart keeps recorded time without restoring authority or counting downtime; older executed plans may lack historical timing.
- Limits: No agent tool can accept a plan.
- Pages: none
- Settings sections: none
- Tools: `code60_create_plan`, `code60_read_plan`, `code60_update_plan`

## Reviews

- ID: `reviews`
- Status: shipped
- Purpose: Inspect pinned revisions and captured worker changes through quiet change links; add exact saved code references to the existing composer.
- Access: Chat → files changed → read-only diff → select code → Add to chat; Changes → older snapshots
- Prerequisite: runtime
- Agent access: existing-tools
- Confirmation: Existing permissions apply.
- Limits: At most eight removable references per message. Corrections use normal chat. Historical evidence does not restore worker ownership; partial changes do not imply success.
- Pages: none
- Settings sections: none
- Tools: `code60_read_review`, `code60_address_feedback`

## Checkpoints and message Undo

- ID: `apply-undo`
- Status: shipped
- Purpose: Automatically checkpoint requests and integrate isolated worker edits; Undo restores covered files and rewinds conversation context without resending.
- Access: Chat → latest user message → Undo
- Prerequisite: runtime
- Agent access: human-only
- Confirmation: Browser confirmation names request and targets, warns about replacing an unsent draft and direct-folder manual edits. Isolated conflicts block rather than overwrite newer edits.
- Limits: Zero-edit requests can rewind. The request and saved-code references return unsent. Direct-folder snapshots also rewind manual edits since their checkpoint; Git metadata and Code60 state are excluded. Direct preimages and current Undo reads allow 32 MiB total regular-file contents, 10,000 entries per folder and 64 directory levels; links are unsupported. Nested children share parent coverage; adding a parent after child execution needs a new request. Checkpoints have bounded 256 MiB storage and 100 prior requests. Interrupted Undo requires explicit recovery, even without a live provider. No automatic commit or reversal of external effects.
- Pages: none
- Settings sections: none
- Tools: none
