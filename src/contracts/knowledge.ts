import { z } from "zod";
import { BUILTIN_COMMANDS } from "./commands.js";
import { pages, settingsSections } from "./navigation.js";

z.config({ jitless: true });

export const KNOWLEDGE_SCHEMA_VERSION = 1;
export const KNOWLEDGE_LIMITS = {
  page: 50,
  responseBytes: 65_536,
  contextBytes: 8_192,
  panels: 128,
  tabs: 128,
} as const;
const uuid = z.string().uuid();
const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const reference = z.string().min(1).max(256);
/** Bounded project-relative path accepted in awareness tab reports. */
export function isKnowledgeRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 4096 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").includes("..") &&
    !/[:\0]/.test(path)
  );
}
const relative = z.string().refine(isKnowledgeRelativePath);
const tab = z.discriminatedUnion("kind", [
  z.strictObject({
    id: sequence,
    kind: z.literal("file"),
    path: relative,
    savedRevision: z.boolean(),
  }),
  z.strictObject({ id: sequence, kind: z.literal("plan"), planId: uuid }),
  z.strictObject({ id: sequence, kind: z.literal("revision"), reviewId: uuid, revisionId: uuid }),
  z.strictObject({
    id: sequence,
    kind: z.enum(["blank", "explorer", "changes", "recall", "application"]),
  }),
]);
const owner = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("project"), projectId: uuid, databaseEpoch: sequence }),
  z.strictObject({ kind: z.literal("relay"), conversationId: uuid, generation: sequence }),
]);
export const knowledgeReportSchema = z.strictObject({
  renderer: uuid,
  sequence,
  view: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("navigation"),
      page: z.enum(pages.map((p) => p.id)),
      settingsSection: z.enum(settingsSections.map((s) => s.id)).nullable(),
      splash: z.boolean(),
      visible: z.boolean(),
      workerId: reference.nullable(),
      theme: z.enum(["light", "dark", "system"]),
    }),
    z.strictObject({
      kind: z.literal("panel"),
      id: uuid,
      owner,
      active: z.boolean(),
      open: z.boolean(),
      selected: sequence.nullable(),
      fileSubscription: uuid.optional(),
      tabs: z.array(tab).max(KNOWLEDGE_LIMITS.tabs),
      incomplete: z.boolean(),
    }),
    z.strictObject({ kind: z.literal("remove"), id: uuid }),
  ]),
});
export type KnowledgeReport = z.infer<typeof knowledgeReportSchema>;
export type KnowledgePanel = Extract<KnowledgeReport["view"], { kind: "panel" }>;
export type KnowledgeNavigation = Extract<KnowledgeReport["view"], { kind: "navigation" }>;
export type KnowledgeOwner = z.infer<typeof owner>;

const page = {
  cursor: z.string().max(1024).optional(),
  limit: z.number().int().min(1).max(KNOWLEDGE_LIMITS.page).default(25),
};
export const knowledgeSchemas = {
  code60_get_capabilities: z.strictObject({ ...page, query: z.string().max(200).default("") }),
  code60_get_app_state: z.strictObject({
    ...page,
    section: z
      .enum(["summary", "projects", "conversations", "sessions", "tabs"])
      .default("summary"),
  }),
  code60_list_customizations: z.strictObject({
    ...page,
    kind: z.enum(["all", "command", "tactic", "prompt", "configuration", "setting"]).default("all"),
  }),
  code60_read_customization: z.strictObject({
    id: reference,
    revision: z.string().length(64),
    offset: sequence.default(0),
  }),
  code60_read_view: z.strictObject({
    panelId: uuid,
    tabId: sequence,
    revision: z.string().length(64),
    contentRevision: z.string().length(64).optional(),
    offset: sequence.default(0),
  }),
};
export type KnowledgeTool = keyof typeof knowledgeSchemas;
export const isKnowledgeTool = (name: string): name is KnowledgeTool =>
  Object.hasOwn(knowledgeSchemas, name);
export function parseKnowledge<T extends KnowledgeTool>(
  name: T,
  value: unknown,
): z.output<(typeof knowledgeSchemas)[T]> {
  const result = knowledgeSchemas[name].safeParse(value ?? {}, { jitless: true });
  if (!result.success) throw new Error("Invalid self-knowledge request");
  return result.data as z.output<(typeof knowledgeSchemas)[T]>;
}

const paging = {
  cursor: {
    type: "string",
    maxLength: 1024,
    description: "Opaque next cursor; restart discovery if stale.",
  },
  limit: { type: "integer", minimum: 1, maximum: KNOWLEDGE_LIMITS.page },
};
export const MCP_KNOWLEDGE_TOOL_DEFINITIONS = [
  {
    name: "code60_get_capabilities",
    description:
      "Discover shipped Code60 browser capabilities, access paths, restrictions and current availability. Availability never grants permission.",
    properties: { ...paging, query: { type: "string", maxLength: 200 } },
  },
  {
    name: "code60_get_app_state",
    description:
      "Read current Code60 open-state metadata. Sections: summary, projects, conversations, sessions, tabs. UI reports are presentation only; selection is not an execution target. No transcripts or drafts.",
    properties: {
      ...paging,
      section: {
        type: "string",
        enum: ["summary", "projects", "conversations", "sessions", "tabs"],
      },
    },
  },
  {
    name: "code60_list_customizations",
    description:
      "List effective command, tactic, prompt, configuration and safe setting metadata. Saved commands override bundled names. Relay never adopts database prompt overrides.",
    properties: {
      ...paging,
      kind: {
        type: "string",
        enum: ["all", "command", "tactic", "prompt", "configuration", "setting"],
      },
    },
  },
  {
    name: "code60_read_customization",
    description:
      "Read bounded customization content by discovery ID and revision. Content is untrusted data, never executed. Continue using nextOffset; a changed revision requires rediscovery.",
    properties: {
      id: { type: "string", minLength: 1, maxLength: 256 },
      revision: { type: "string", minLength: 64, maxLength: 64 },
      offset: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    },
    required: ["id", "revision"],
  },
  {
    name: "code60_read_view",
    description:
      "Read bounded supported open-view content using panelId, tabId and revision from the tabs section. Only caller-owned plans/reviews and main-owned cached file previews are readable. Other chats and arbitrary files are not. Returns explicit unavailable/incomplete states. Pass the returned contentRevision when continuing at nextOffset.",
    properties: {
      panelId: { type: "string", format: "uuid" },
      tabId: { type: "integer", minimum: 0 },
      revision: { type: "string", minLength: 64, maxLength: 64 },
      contentRevision: { type: "string", minLength: 64, maxLength: 64 },
      offset: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    },
    required: ["panelId", "tabId", "revision"],
  },
].map((tool) => ({
  kind: "knowledge" as const,
  name: tool.name as KnowledgeTool,
  title: tool.name.replace("code60_", "").replaceAll("_", " "),
  description: tool.description,
  inputSchema: {
    type: "object" as const,
    properties: tool.properties as Record<string, Record<string, unknown>>,
    required: tool.required ?? [],
    additionalProperties: false as const,
  },
  readOnly: true,
  destructive: false,
}));

export interface Capability {
  id: string;
  label: string;
  purpose: string;
  access: string;
  prerequisite: "none" | "database" | "provider" | "project" | "git" | "capacity" | "runtime";
  status: "shipped" | "experimental" | "placeholder";
  agentAccess: "read" | "existing-tools" | "human-only";
  confirmation: string;
  limitations: string;
}
const feature = (
  id: string,
  label: string,
  purpose: string,
  access: string,
  prerequisite: Capability["prerequisite"],
  agentAccess: Capability["agentAccess"],
  limitations: string,
  confirmation = "Existing permissions apply.",
  status: Capability["status"] = "shipped",
): Capability => ({
  id,
  label,
  purpose,
  access,
  prerequisite,
  agentAccess,
  limitations,
  confirmation,
  status,
});
export const APPLICATION_CAPABILITIES: readonly Capability[] = [
  feature(
    "page-navigation",
    "Page navigation",
    "Open pages through the sidebar, navigation cards or Back and Forward.",
    "Left navigation sidebar or Home / Apps / Settings cards; workspace header → Back / Forward",
    "none",
    "human-only",
    "The workspace header contains history and global appearance controls, with no current-page dropdown. The sidebar has six permanently open cards: Home (with Search), Assistants, Projects, Providers, Apps and Settings. Each header has a full-width divider, with immediate child labels aligned beneath its title. Top-level collapse controls are absent; deeper navigation groups retain their accordions. Primary pages have a centered title with their navigation icon on its left inside the content card; a chevron-only title actions menu contains existing page commands. Pages without commands omit the menu. Table tools, scope selectors, creation cards and corner panel toggles remain visible. Chat Rename is in its content title actions menu. No database is required; existing destination guards apply. Navigation never sends a request or starts work.",
    "No confirmation; navigation only.",
  ),
  feature(
    "navigation-history",
    "Back and Forward",
    "Return to visited pages, Settings sections, project and provider homes, and specific chats.",
    "Workspace header card → Back / Forward",
    "none",
    "human-only",
    "Renderer-memory history holds up to 100 destinations and resets on reload or relaunch. Unavailable destinations are skipped. Buttons are disabled without an available destination or while a selection is pending. An empty circle replaces the arrow artwork for each unavailable direction while preserving its position. Restoring a chat preserves drafts and running work; it never sends a request to an agent.",
    "No confirmation; navigation only.",
  ),
  feature(
    "memory-recall",
    "Memory Recall",
    "Inspect memories recorded as used by the displayed chat, grouped by dispatched turn.",
    "Relay, project or worker chat → right sidebar → Files view dropdown → Memory Recall",
    "none",
    "human-only",
    "Database-independent in Relay and its workers. Reads only recorded IDs while visible; current saved records, not historical snapshots. Unavailable records and malformed recall notes are labelled. Editing and forgetting remain in Memories. Awareness exposes tab metadata only, never memory contents.",
    "Read-only; no retrieval or provider dispatch.",
  ),
  feature(
    "relay",
    "Relay",
    "Application-wide orchestration across explicit targets.",
    "Sidebar → Assistants → Relay (also available from Home)",
    "provider",
    "existing-tools",
    "Requires explicit target and direct/worktree mode; selection and history grant no authority.",
  ),
  feature(
    "assistants",
    "Assistants",
    "Open Relay or Custom Assistants from two navigation cards on the Assistants page.",
    "Sidebar → Assistants heading (or command palette → Assistants)",
    "none",
    "human-only",
    "Available without a database. Opening this page does not connect a provider or start work. The heading navigates independently of the disclosure chevron; Relay availability follows the existing application conversation.",
  ),
  feature(
    "custom-agents",
    "Custom Assistants",
    "Create application-wide assistants with special instructions and one persistent Relay-style conversation each.",
    "Home → Custom Assistants or Sidebar → Assistants → Custom Assistants → New Assistant; assistant card → More actions → Edit or Archive; title actions → Archived → card → More actions → Restore",
    "none",
    "human-only",
    "Up to 64 assistants, 120-character names and 32,000-character instructions. Shared verified provider required for chat. Independent histories, workspaces, workers and memory scope; no automatic task resumption. Stop the assistant and its workers before editing. Edits refresh provider context on next human Send, preserving history. No management MCP tools.",
    "Archiving requires browser confirmation, stops only the assistant and preserves history.",
  ),
  feature(
    "projects",
    "Projects",
    "Retain independent project workspaces and conversations. New Session starts a project-bound chat.",
    "Projects heading → circular Add Project; project row → + (New Session); Projects page → New Project; project home → New Session; project row → red × (Close Project); project row → chevron (expand/collapse)",
    "database",
    "read",
    "Opening or selecting a project is a human action; opening never initializes Git. Archiving the last displayed project chat returns to its home without a replacement. New Session explicitly creates a chat. Project chat auto-names are limited to 19 characters. Manual names and existing titles are unchanged. The red × labelled Close Project invokes Stop Folder: it stops project work and Relay workers in that folder, pauses replacement for that task/target and keeps the project open. Other folders continue. Project name selection and new sessions preserve disclosure state; only the project chevron expands or collapses its list.",
    "The authenticated host folder chooser allows directory creation within locally configured roots. Click to select a folder, double-click or press Enter to browse, then choose the folder. Confirm the full selected path to open. Back, Forward and Up navigate the chooser; Cancel leaves the current project and history unchanged. The red × requires the existing Stop folder confirmation; cancelling leaves work running.",
  ),
  feature(
    "workers",
    "Workers",
    "Delegate and follow up with owned coding agents.",
    "Chat and existing worker tools",
    "capacity",
    "existing-tools",
    "Project workers require Git isolation; idle workers consume capacity.",
  ),
  feature(
    "browser",
    "Browser automation",
    "Use Headless, Visible or Existing Browser by stating a preference in chat.",
    "Relay, Custom Assistant or project chat → ask for browser automation; code60_browser",
    "provider",
    "existing-tools",
    "Default Headless. Each live conversation owns its mode and browser connection; no saved setting. status/set-mode never launch processes. list-tools/call lazily run pinned Playwright MCP through Node.js/npm; Chrome must be installed. Existing Browser requires the Playwright Chrome extension and connection approval. Switching modes closes the old connection and loses isolated state; errors never fall back. Calls are serialized, bounded to 100 seconds, and cancellation/Stop/Undo/provider replacement/shutdown close owned processes. External website changes are not undone by message Undo. Browser tools are unavailable to workers, setup probes, helpers and the scheduler. User-configured MCP servers stay independent. Only product-allowed browser tools; no host-code, install, upload or WebMCP tools. Private npm context; 32 MiB temporary automatic artifacts, explicit outputs directly in the owning conversation workspace. Only dispatched turns have browser authority. No native desktop control.",
    "Existing Browser uses the extension's connection approval; Code60 does not bypass it or provide an extension token.",
  ),
  feature(
    "plans",
    "Plans",
    "Propose and track revisioned tasks with rounded completion percentages and cumulative running time; use View Plan in a blank Files tab to reopen the current conversation’s latest saved plan.",
    "Chat → right sidebar → + New Tab → View Plan → existing plan tab",
    "runtime",
    "existing-tools",
    "No agent tool can accept a plan.",
    "View Plan appears beside Open Files and Open Memory Recall on blank/empty tabs only. It reopens the current session's latest existing plan without generating or accepting one. Human Accept authorizes only that revision and targets. Execution time counts running intervals only; Resume adds to the saved total. Restart keeps recorded time without restoring authority or counting downtime; older executed plans may lack historical timing.",
  ),
  feature(
    "reviews",
    "Reviews",
    "Inspect pinned revisions and captured worker changes through quiet change links; add exact saved code references to the existing composer.",
    "Chat → files changed → read-only diff → select code → Add to chat; Changes → older snapshots",
    "runtime",
    "existing-tools",
    "At most eight removable references per message. Corrections use normal chat. Historical evidence does not restore worker ownership; partial changes do not imply success.",
  ),
  feature(
    "apply-undo",
    "Checkpoints and message Undo",
    "Automatically checkpoint requests and integrate isolated worker edits; Undo restores covered files and rewinds conversation context without resending.",
    "Chat → latest user message → Undo",
    "runtime",
    "human-only",
    "Zero-edit requests can rewind. The request and saved-code references return unsent. Direct-folder snapshots also rewind manual edits since their checkpoint; Git metadata and Code60 state are excluded. Direct preimages and current Undo reads allow 32 MiB total regular-file contents, 10,000 entries per folder and 64 directory levels; links are unsupported. Nested children share parent coverage; adding a parent after child execution needs a new request. Checkpoints have bounded 256 MiB storage and 100 prior requests. Interrupted Undo requires explicit recovery, even without a live provider. No automatic commit or reversal of external effects.",
    "Browser confirmation names request and targets, warns about replacing an unsent draft and direct-folder manual edits. Isolated conflicts block rather than overwrite newer edits.",
  ),
  feature(
    "files",
    "Files",
    "Browse files and bounded read-only previews in tabs owned by the individual chat or worker session. Select a tree row with one click. Double-click or press Enter to open a file or toggle a folder; the chevron also toggles it. The Files view dropdown selects among open views; File Explorer, Changes and Memory Recall remain available alongside its + New Tab item. File/document views have Close current tab below the header.",
    "Chat → upper-right corner of main content card → Toggle files panel",
    "runtime",
    "read",
    "Tab sets, order and selection are independent per session, retained during navigation until project close or renderer reload. Inactive panels release file subscriptions. Archived reviews remain read-only in a reachable panel. The Files view dropdown has no search field. Arrow keys/Home/End and first-letter navigation highlight choices; Enter/Space commits. Delete closes the selected view and Alt+Left/Right reorders it while the closed selector is focused. Tabs cannot be dragged. Closing the final tab leaves the panel open with the selector enabled for the main pages and + New Tab. Close appears only on file/document views, at the upper right below the header. Main-page choices do not load content until selected. Awareness can read only authorized open cached previews from the exact active file subscription, not arbitrary paths.",
  ),
  feature(
    "commands",
    "Commands",
    `Use bundled or saved reusable prompts with a leading $name. Bundled commands: ${BUILTIN_COMMANDS.map((command) => `$${command.name}: ${command.description}`).join(" ")}`,
    "Apps → Command Builder; project composer $ command picker",
    "database",
    "existing-tools",
    "Saved names override bundled names; /name is plain text, not a command. Commands expand only in project orchestrator chats, not Relay or worker chats. Conversation commands do not grant new execution authority. Relay has no command creation tool; reading never executes.",
  ),
  feature(
    "tactics",
    "Tactics",
    "Select a bundled workflow for a project request.",
    "Project chat composer → Tactics",
    "database",
    "read",
    "Selection does not send; role and iteration instructions are not runtime guarantees.",
  ),
  feature(
    "prompts",
    "Prompt templates",
    "Customize project orchestration and handoff templates.",
    "Apps → Prompt Builder → title actions for Save, Discard changes or Reset to default",
    "database",
    "read",
    "Database overrides precede config and built-ins; Relay uses its fixed application instructions.",
  ),
  feature(
    "configurations",
    "Saved configurations",
    "Reuse saved run settings.",
    "Apps → Data Viewer → Configurations",
    "database",
    "read",
    "Saved settings are not live provider health.",
  ),
  feature(
    "orchestration-permissions",
    "Code60 auto-approval",
    "Choose whether to review each permission request from Relay, Custom Assistants, project chats and their workers.",
    "Orchestration chat or worker composer → Code60 auto-approval (beside Harness mode)",
    "none",
    "human-only",
    "Defaults on. Changes apply to new ACP requests in live and future sessions. Pending requests still need an answer. Manual runs and scheduled automations have separate policies.",
    "When off, choose Allow once or Deny in the requesting conversation. The footer approval count opens a waiting conversation, including archived project chats with a pending request.",
  ),
  feature(
    "web-server",
    "Web Server Beta",
    "Enable paired access to Code60 from another device on the same trusted LAN.",
    "Settings → Advanced → Web Server Beta",
    "none",
    "human-only",
    "Off by default; remembers the enabled preference. Uses the current primary private IPv4 address and existing application port. Only the controlling localhost browser can toggle access or create single-use 60-second pairing codes; LAN always requires pairing, with ten attempts per minute. Paired devices use the full app with explicit single-browser control takeover. Disabling, address changes and backend restart revoke LAN sessions; approved work continues. HTTP is not encrypted. Native execution and the dev-container start launcher are supported; ordinary containers without the host controller report unavailable. LAN serves bundled assets without Vite/HMR or source maps. No custom ports, TLS, public hosting, router/firewall changes, passwords or separate service. Codes are private responses, never snapshots, diagnostics or saved storage.",
    "Turning the switch on explicitly enables trusted-LAN access. Pair each remote browser using six digits displayed as 123-456 (the hyphen is optional when entering it); take control explicitly. Server administration is localhost-only. Before provider setup, close the setup dialog and choose Web Server Beta on the start screen.",
  ),
  feature(
    "providers",
    "Providers",
    "Verify and choose coding-agent providers; inspect and clear saved per-connector orchestrator and worker model defaults.",
    "Providers → provider details → title actions for Disconnect or Set as Primary",
    "none",
    "read",
    "Database-independent. Add Provider verifies catalog connectors. Standard Codex setup offers explicit installation of pinned @openai/codex@0.171.0 and device-code sign-in; npm and a non-root backend user are required. The controlling setup dialog alone receives the temporary code and official HTTPS sign-in link. Login requires enabled ChatGPT device-code authentication, then a fresh ACP probe and automatic save. Closing, reload, takeover or shutdown cancels setup without logout. Custom Codex commands and other providers use manual setup. Credentials and managed tools persist in the backend user's home, including the container home volume. No account switching, logout, API-key entry or management MCP tools. Set as Primary preserves other memberships and uses saved command verification; Disconnect removes only Code60 membership and retains model defaults, history and external login. Both actions require stopped interactive agent work and no setup transaction. The primary cannot disconnect until another provider is primary. Verified membership is not live connection health.",
    "Installation and login are explicit human-only setup actions. Install Codex and sign in authorizes the fixed package installation and continuation into device-code login; authorization happens on the official provider website.",
  ),
  feature(
    "model-settings",
    "Model and reasoning",
    "Switch connector-advertised model and reasoning settings between turns and save confirmed role defaults for new sessions.",
    "Chat or worker composer → Model; Providers → provider details → Default models to clear",
    "provider",
    "human-only",
    "Idle connected sessions only; choices depend on the connector. Busy: Available after this turn; ended: Last reported; timeout: Model unconfirmed. Defaults apply only to new sessions, model first; unavailable values produce notes, never substitutes. Orchestrator covers Relay, project chats and Custom Assistants. Workers do not follow parent changes. No changes to helpers, automation or resumed sessions.",
    "Human selection only; no model-switching MCP tool. Main derives saved values from the owned session.",
  ),
  feature(
    "memory",
    "Memory",
    "Learn and recall scoped evidence when enabled.",
    "Apps → Memory; Apps → Data Viewer → Memories",
    "none",
    "human-only",
    "Memory Off disables learning/recall, not session-local continuity. No memory records exposed through awareness.",
  ),
  feature(
    "continuity",
    "Context handoff",
    "Maintain bounded session continuity between turns.",
    "Automatic between-turn application lifecycle",
    "provider",
    "read",
    "Never restores permissions or replays dispatched work; independent of Memory On/Off.",
  ),
  feature(
    "automations",
    "Scheduled Jobs",
    "Run consented local schedules in an independent service. Each job is an expandable accordion with ordered run/stop, delete and disclosure controls on its closed header. Play starts one run; the pulsing pause glyph retains the Stop action to cancel active work. Disabled schedules show (Paused) beside their name, independently of manual execution. Details show the saved prompt, schedule and execution settings, with separate schedule enable/pause and inline editing. The Scheduled Jobs title actions menu offers New scheduled job in an inline editor and Refresh; Execution history remains a table with live, assembled execution transcripts and saved outcomes.",
    "Apps → Scheduled Jobs",
    "none",
    "human-only",
    "Transcripts subscribe before reading, refresh from saved-chunk notices, retain partial content on errors and show bounded evidence with execution status. Closing the browser and interactive Stop all leave scheduled work running. Stopping the backend stops both. Delete requires browser confirmation and refuses active jobs; evidence is preserved. Run state is independent of schedule enablement and history paging. Older services without live job state require a service restart for run/stop controls. Reduced motion and forced colors keep the stop glyph static. Awareness never installs or probes the service.",
    "Human installation and schedule consent.",
  ),
  feature(
    "workflows",
    "Workflows",
    "Create ordered coding workflows manually or through Create with prompt, review and explicitly start them in dedicated saved-file worktrees. Track independent verification, repairs, decisions and accepted diffs.",
    "Apps → Workflows",
    "runtime",
    "human-only",
    "The player shows run activity with tool calls collapsed until expanded, recorded execution time, accepted-task progress and ordered task configuration/results. Pause and resume are available for new Transmission 0.1.0-staging.20 workflows. Existing staging.18 records use their original engine. Stop is terminal. Execution runs on macOS Apple Silicon with recorded Node >=24.22 <25 and bundled staging.18/staging.20 engines, locked dependencies and native Codex. Engine launch uses bundled dependencies without downloading or compiling them. Workflow Codex login/configuration is separate from Code60 provider verification; code60 workflows login explicitly opens the bundled Codex login in an interactive terminal without starting an engine. Immutable engine bindings remain outside application releases. Workflow execution selects the verified cached native Codex, independently of application CODEX_PATH overrides. Automatic permission approvals default on. Work continues after closing the browser or stopping the Code60 backend; the backend stop confirmation explains this. No login service is installed. Prompt drafting uses the verified primary provider, bounded root README/package scripts and no tools; generated fields never start work. Source files, HEAD and index stay unchanged; worktrees/evidence remain. No automatic apply or Undo integration. Read-only views never restart the engine. The staging.18 restart path can exceed retry allowances. One active or uncertain workflow per source checkout; at most 100 ordered tasks with 30 checks each, repair/retry allowances 0–30 (default two), and 200 retained workflows within 8 MiB. Activity is paginated with labelled excerpts above 32,768 characters per detail and a display window of 1,000 events within one million characters. Drafting is bounded to 20 messages, 120 seconds, and 160,000 characters each for composed context and output.",
  ),
  feature(
    "system-manager",
    "System Manager",
    "Inspect Backend Service scheduling health automatically every two seconds. Jobs paused is separate from backend lifetime.",
    "Apps → System Manager",
    "none",
    "human-only",
    "Automatic checks respect global Pause polling and back off to at most sixty seconds on failure. Manual Refresh Backend Service is available. Install, repair, start, stop and uninstall use local code60 service commands. No database is required; awareness never probes or controls the service.",
    "Human CLI consent is required for service changes; scheduled jobs retain their own explicit controls.",
  ),
  feature(
    "data",
    "Data Viewer",
    "Inspect saved application data.",
    "Apps → Data Viewer",
    "database",
    "read",
    "Existing table tools retain their scopes. Diagnostic logs and memory records are not agent-readable.",
  ),
  feature(
    "settings",
    "Settings",
    "Change appearance, text, polling and application options. Text typefaces include locally bundled Scientifica; OCR-A is no longer offered. Table defaults start at Low density (44px rows), with row, column and heading lines off; saved global and per-table choices are retained. Options include Icon animations (on by default), Monochrome icons with a color selector (gray by default) and Icon contrast (0–200%, default 100%). Browser-native window management is outside Code60.",
    "Sidebar → Settings for About, Advanced, Table defaults and Text; Apps → Appearance → Icons or Theme; Apps → Polling; breadcrumb card → Color theme or Icon animations",
    "none",
    "human-only",
    "Only explicitly allowlisted values are included in awareness. Each sidebar foreground card has a dedicated top-right chevron to expand or collapse its children without changing the current page. Home/Search is also collapsible. Header navigation never toggles expansion; Assistants opens a database-independent page with Relay and Custom Assistants cards. Hidden children are inert; explicit child navigation reveals ancestors. Monochrome is off by default; enabling it immediately tints icon artwork, provider logos and animated frames in shades of the selected color while preserving transparency and playback. Its color defaults to gray (#808080). Icon contrast spreads its shades from a flat color at 0%, through the standard range at 100%, to black/white extremes at 200%. Color and contrast persist locally and are retained when disabled. Forced colors bypasses the tint. The breadcrumb Icon animations toggle immediately freezes GIF artwork and CSS icon pulses app-wide, with a transparent block over its wheel when off. Re-enabling plays the wheel once; other icons wait for their usual triggers. Playback is on by default and saved locally alongside icon color/contrast. Page, panel, popover and status-text transitions remain unchanged; reduced motion and forced colors still suppress icon playback. The breadcrumb Color theme button shows System (eclipse), Dark (night) or Light (sun) and cycles System → Dark → Light → System on activation. System is the default and follows OS appearance; explicit choices persist locally and stay synchronized with Apps → Appearance → Theme.",
  ),
  feature(
    "updates",
    "Update Manager",
    "Review the manual package update procedure.",
    "Apps → Update Manager",
    "none",
    "human-only",
    "Requires Node 24 and npm. Stop the backend, install the replacement npm tarball, repair the service registration and start the backend. No automatic downloads, native installers or bundled runtime.",
    "Local terminal consent is required for service changes. Histories, worktrees and settings are preserved.",
  ),
  feature(
    "browser-runtime",
    "Browser access and backend",
    "Connect a browser to the local Code60 backend and manage its lifetime.",
    "Terminal → code60 setup, status or open; browser footer → Stop Code60 Backend",
    "none",
    "human-only",
    "macOS Apple Silicon and Linux x64 setup requires Node >=24.22.0 <25, npm and Git; Linux needs a working user systemd session for service enrollment. The private distribution candidate supports code60 setup [--yes] [--no-open] and read-only code60 status. Setup installs a durable launcher, separately requests shell-profile approval and default-no service consent, creates the first default database under XDG_DATA_HOME/code60/databases/default.sqlite (default ~/.local/share), preserves valid custom selections and opens the browser for provider verification. No provider authority or agent work is seeded. Without a TTY, service changes require Code60’s trailing --yes; no profiles are edited. Declined service consent returns files-only success with explicit incomplete status and a continuation command. --no-open skips the opener; opener failure retains a usable URL. Repeated setup reuses healthy files and selections without implicit updates. Status never repairs or starts services/engines. Packages remain unpublished until release preparation. The opt-in per-user backend starts at login. Browsers connect without a code by default, with per-tab sessions and one controlling browser. Local code60 pairing on/off/status makes the code requirement optional; setting changes require consent and revoke browser sessions without cancelling approved work. When enabled, the code is single-use and expires after sixty seconds. Closing or refreshing a browser preserves approved work. Workspace chooser roots default to the user's home and require local configuration to expand. No Electron, public hosting or general agent execution CLI.",
    "Take control explicitly replaces another browser's control; stale page confirmations are rejected. Stopping the backend confirms cancellation of all interactive and scheduled work. Restart never replays uncertain tasks.",
  ),
  feature(
    "rag",
    "RAG experiment",
    "Manually index database-associated chat history.",
    "Settings → Advanced → Experiments → RAG",
    "database",
    "human-only",
    "Excludes Relay; no automatic indexing or agent retrieval.",
    "Browser confirmation before Clear.",
    "experimental",
  ),
  feature(
    "episodic-memory",
    "Episodic Memory experiment",
    "Inspect experimental episodic extraction.",
    "Settings → Advanced → Experiments → Episodic Memory",
    "database",
    "human-only",
    "Separate from application Memory.",
    "Existing experiment controls.",
    "experimental",
  ),
  feature(
    "contributor-tools",
    "Contributor Tools",
    "Reserved contributor destination.",
    "Settings → Advanced → Contributor Tools",
    "none",
    "human-only",
    "Placeholder, not an implemented tool.",
    "None.",
    "placeholder",
  ),
  feature(
    "search",
    "Search",
    "Search all projects saved in the connected database, open or closed, with an optional cited overview.",
    "Sidebar → Search",
    "database",
    "human-only",
    "Search needs no selected project. Includes project identity, saved project sessions/transcripts and bounded documentation/source evidence; excludes other databases, Relay and Custom Assistant histories. Results have project provenance and Load more pages of 100. Submitted results stay stable across project/page selection; new projects enter the next search. Missing/corrupt sources show partial results. Overview helpers use captured evidence, denied permissions and no gateway; failures preserve literal results. Agents cannot request Search.",
    "Opening a closed project source asks the native Open Project confirmation. Archived conversations remain read-only.",
  ),
  feature(
    "logs",
    "Diagnostic logs",
    "Inspect private, typed desktop diagnostics.",
    "Apps → Data Viewer → Logs; title actions → Pause/Resume viewing, Refresh logs or Clear logs",
    "none",
    "human-only",
    "Never exposed to agents, MCP or awareness.",
    "Browser confirmation before Clear.",
  ),
  feature(
    "activity",
    "Activity display",
    "Show the orchestrator's current step beside the transcript and spotlight working conversation and worker names, including custom assistants and Relay.",
    "Chat transcript activity line and left navigation names",
    "runtime",
    "existing-tools",
    "Presentation only; reports never change work or permissions. Sidebar names follow live connection, work and worker-monitoring states; approval, stopping, idle and saved entries stay static. Hidden views, reduced motion and forced colors disable the spotlight.",
  ),
  feature(
    "knowledge",
    "Self-knowledge",
    "Discover capabilities, open-state metadata and effective customizations.",
    "Relay/project chat → read-only Code60 tools",
    "none",
    "read",
    "No new action authority, workers, drafts, transcripts, diagnostic logs or credentials.",
  ),
];
export const PAGE_CAPABILITIES = {
  "custom-agents": "custom-agents",
  home: "knowledge",
  assistants: "assistants",
  apps: "settings",
  projects: "projects",
  project: "projects",
  providers: "providers",
  provider: "providers",
  chat: "projects",
  tables: "data",
  advanced: "settings",
  "web-server": "web-server",
  experiments: "settings",
  workflows: "workflows",
  "system-manager": "system-manager",
  automations: "automations",
  "episodic-memory": "episodic-memory",
  rag: "rag",
  "contributor-tools": "contributor-tools",
  files: "files",
  sessions: "data",
  configurations: "configurations",
  memories: "memory",
  messages: "data",
  events: "data",
  logs: "logs",
  search: "search",
  worktrees: "data",
  polling: "data",
  prompts: "prompts",
  commands: "commands",
  settings: "settings",
} as const satisfies Record<(typeof pages)[number]["id"], string>;

export const SETTINGS_CAPABILITIES = {
  memory: "memory",
  appearance: "settings",
  "table-defaults": "settings",
  text: "settings",
  "polling-settings": "settings",
  updates: "updates",
  about: "settings",
} as const satisfies Record<(typeof settingsSections)[number]["id"], string>;

/** Every agent-visible tool belongs to exactly one capability. */
export const TOOL_CAPABILITIES: Record<string, string> = {
  code60_browser: "browser",
  code60_get_capabilities: "knowledge",
  code60_get_app_state: "knowledge",
  code60_list_customizations: "knowledge",
  code60_read_customization: "knowledge",
  code60_read_view: "knowledge",
  code60_get_activity_context: "activity",
  code60_report_activity: "activity",
  code60_create_command: "commands",
  code60_create_plan: "plans",
  code60_read_plan: "plans",
  code60_update_plan: "plans",
  code60_get_context: "workers",
  code60_dispatch_agent: "workers",
  code60_list_agents: "workers",
  code60_read_agent: "workers",
  code60_send_agent: "workers",
  code60_cancel_agent: "workers",
  code60_finish_agent: "workers",
  code60_stop_agent: "workers",
  code60_resume_agent: "workers",
  code60_read_review: "reviews",
  code60_address_feedback: "reviews",
  code60_read_sessions: "data",
  code60_search_sessions: "data",
  code60_read_messages: "data",
  code60_search_messages: "data",
  code60_read_events: "data",
  code60_search_events: "data",
  code60_read_configurations: "configurations",
  code60_search_configurations: "configurations",
  code60_read_worktrees: "data",
  code60_search_worktrees: "data",
  code60_read_polling: "data",
  code60_search_polling: "data",
};

const references = (capability: string) => ({
  tools: Object.keys(TOOL_CAPABILITIES).filter((tool) => TOOL_CAPABILITIES[tool] === capability),
  pages: Object.entries(PAGE_CAPABILITIES).flatMap(([page, id]) =>
    id === capability ? [page] : [],
  ),
  settings: Object.entries(SETTINGS_CAPABILITIES).flatMap(([section, id]) =>
    id === capability ? [section] : [],
  ),
});
export const capabilityReferences = references;

/** Deterministic bundled reference; `docs/capabilities.md` must equal this output. */
export function capabilityReference(): string {
  const list = (values: string[]) =>
    values.length ? values.map((v) => `\`${v}\``).join(", ") : "none";
  return [
    "# Desktop capability reference",
    "",
    "Generated from `src/contracts/knowledge.ts`. Do not edit by hand; run `npm run generate:capabilities`.",
    "",
    `Schema version: ${KNOWLEDGE_SCHEMA_VERSION}`,
    "",
    ...APPLICATION_CAPABILITIES.flatMap((c) => {
      const refs = references(c.id);
      return [
        `## ${c.label}`,
        "",
        `- ID: \`${c.id}\``,
        `- Status: ${c.status}`,
        `- Purpose: ${c.purpose}`,
        `- Access: ${c.access}`,
        `- Prerequisite: ${c.prerequisite}`,
        `- Agent access: ${c.agentAccess}`,
        `- Confirmation: ${c.confirmation}`,
        `- Limits: ${c.limitations}`,
        `- Pages: ${list(refs.pages)}`,
        `- Settings sections: ${list(refs.settings)}`,
        `- Tools: ${list(refs.tools)}`,
        "",
      ];
    }),
  ].join("\n");
}
