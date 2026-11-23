# Code60 roadmap

## In Progress

1. Orchestrator Internal Tools\
 a.  Open/Close/Navigate tabs.\
 b.  Diagnostic Troubleshooting\
 c. Comprehensive Keyboard Controls
1. Workflow Engine\
  a. Multi-Session Orchestration\
  b. Independent Verification\
  c. Retry Policies\
  d. Crash Recovery
1. MCP UX\
  a. In-App Configuration\
  b. Agent-Assisted Setup

## Short-Term

1. In-App Browser
1.  App-Initiated Sign-In\
 a.  Claude\
 b.  Codex\
 c.  OpenCode
1. Enhanced Computer Use

## Long-Term
1. Multi-User Collaboration

## Considering
1. Windows Support

## Complete

Implemented capabilities and improvements:

✅ Desktop application for macOS Apple Silicon and Linux x64.\
✅ Parallel coding agents with isolated Git worktrees.\
✅ Relay: one application-wide conversation that works without an open project or database.\
✅ Relay delegation to explicitly selected repositories and folders, including unopened projects.\
✅ Explicit direct-folder and isolated-worktree execution modes.\
✅ Persistent Relay history with bounded context supplied when a new conversation starts.\
✅ Multiple open projects with independent chats, drafts and file views.\
✅ Restore open projects and saved chats after restarting, without automatically resuming work.\
✅ Persistent chat titles, archive state and conversation history.\
✅ Custom Assistants with special instructions and independent persistent conversations.\
✅ Edit, archive and restore Custom Assistants while preserving their history.\
✅ Worker delegation, follow-up messages, progress inspection and cancellation.\
✅ Separate controls to stop project work, workers in a folder or all desktop-owned work.\
✅ Revisioned plans with explicit human acceptance of the displayed plan and targets.\
✅ Automatic request checkpoints and integration of settled isolated worker edits.\
✅ Message Undo that restores covered files and rewinds conversation context.\
✅ Bounded direct-folder snapshots for Undo, with explicit warnings about concurrent manual edits.\
✅ Read-only change previews and a Changes browser for older snapshots.\
✅ Add selected code from a saved diff to chat with its exact version and line references.\
✅ Preserve partial and unsuccessful worker changes as review evidence.\
✅ File browsing and bounded read-only previews within chat workspaces.\
✅ Markdown replies with code blocks, lists, tables and source-preserving Copy.\
✅ Live activity indicators beside chat transcripts.\
✅ Coding-agent provider setup and verification.\
✅ Model and reasoning selection between turns, using connector-advertised choices.\
✅ Saved model defaults for new orchestrator and worker sessions.\
✅ Configurable Code60 auto-approval, with Allow once and Deny when manual review is enabled.\
✅ Reusable saved prompts through Command Builder and the project chat command picker.\
✅ Bundled planning and business-evaluation commands.\
✅ Selectable project workflow tactics.\
✅ Customizable orchestration and handoff prompt templates through Prompt Builder.\
✅ Saved run configurations that can be reused across work.\
✅ Application-wide memory learning and recall with an On/Off switch.\
✅ Local memory storage, embeddings and retrieval.\
✅ Memory management with evidence, editing, pinning, forgetting and retention controls.\
✅ Project-scoped memories and explicit promotion to global memory.\
✅ Memory Recall tabs showing the memories recorded for each dispatched turn.\
✅ Automatic context handoff between turns for long conversations.\
✅ Search across saved project evidence with an optional cited overview.\
✅ Manual offline conversation-indexing and retrieval experiment.\
✅ Scheduled Jobs with interval, daily and weekly schedules and explicit tool permissions.\
✅ Independent background scheduling that can continue after the desktop app quits.\
✅ System Manager controls to install, repair, start, stop and uninstall the background service.\
✅ Data Viewer for saved sessions, messages, events, worktrees and other application records.\
✅ Private typed desktop diagnostics and an in-app log viewer.\
✅ Appearance, text, table-density and polling settings.\
✅ Collapsible sidebar groups, adjustable sidebar opacity and native macOS desktop blur.\
✅ In-app update checks, cancellable downloads and confirmed installation and restart.\
✅ macOS DMG and Linux DEB/AppImage packaging with release-validation workflows.\
✅ Sandboxed desktop renderer, validated bridge requests and an authenticated local MCP gateway.\
✅ Agent-readable capability discovery and scoped application-state awareness.\
✅ Removal of the public Code60 CLI and Windows support while preserving existing user data.
