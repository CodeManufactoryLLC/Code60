# Level 3 Components inside Browser SPA (src/renderer/)
appShell = component "App Shell" "Carbon header, sidebar, Chat History." "React / Carbon"
chatSurface = component "Chat Surface" "AI Chat, activity, commands, Undo." "Carbon AI Chat"
workspacePanels = component "Workspace Panels" "Files, Monaco diffs, Plans, xterm.js." "Monaco / Tree / xterm"
opsAndConfigViews = component "Ops & Config Views" "Jobs, Workflows, MCP, Providers, Usage." "React / Carbon"
browserClient = component "Browser Client" "HTTP/SSE RPCs, auth, controller lease." "Fetch / SSE"

appShell -> browserClient "Workspace state"
chatSurface -> browserClient "Prompts and events"
workspacePanels -> browserClient "Files, diffs, PTYs"
opsAndConfigViews -> browserClient "Config and ops RPCs"
appShell -> chatSurface "Selects chat"
appShell -> opsAndConfigViews "Routes views"
chatSurface -> workspacePanels "Syncs tabs and diffs"
