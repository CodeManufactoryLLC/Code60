# Level 3 Components inside Browser SPA (src/renderer/)
appShell = component "Carbon App Shell & Navigation" "Product header (Commands, Back/Forward, auto-approve, Workspace modal), 7 collapsible Carbon SideNavMenu groups, and Chat History panel." "React 19, @carbon/react"
chatSurface = component "Chat & Orchestration Surface" "IBM Carbon AI Chat threads for Relay, Custom Assistants, project chats, and workers; inline activity display, / and $ command picker, and Tactics selector." "React 19, @carbon/ai-chat"
workspacePanels = component "Workspace Inspector Panels" "Right-sidebar PanelShell hosting Headless Tree File Explorer, read-only Monaco previews/diffs, Plans viewer, Memory Recall, and xterm.js terminals." "Headless Tree, Monaco, xterm.js"
opsAndConfigViews = component "Management & Configuration Views" "Scheduled Jobs, Workflows player, MCP Servers (User/Project + Edit JSON modal), Providers setup, Health Check, Usage, Data Viewer/Logs, Settings, and Web Server Beta." "React 19, @carbon/react, Monaco"
browserClient = component "Browser Gateway Client" "Typed HTTP/SSE client attaching window.code60, managing per-tab sessionStorage tokens, single-controller lease, SSE resync, and host interaction dialogs." "TypeScript Fetch + EventSource"

appShell -> browserClient "Queries workspace state, database chooser, and global controls"
chatSurface -> browserClient "Sends prompts, handles approvals/Undo, and streams chat updates"
workspacePanels -> browserClient "Reads cached file previews, diffs, plans, recall, and PTY streams"
opsAndConfigViews -> browserClient "Manages schedules, workflows, MCP configs, providers, health, usage, and LAN"
appShell -> chatSurface "Routes active conversation selection"
appShell -> opsAndConfigViews "Routes active navigation page or settings section"
chatSurface -> workspacePanels "Synchronizes active session tabs, diffs, and code references"
