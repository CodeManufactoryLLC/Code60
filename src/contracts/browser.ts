import { z } from "zod";
import { parseValue } from "./index.js";

z.config({ jitless: true });

export const browserModes = ["headless", "visible", "existing-browser"] as const;
export type BrowserMode = (typeof browserModes)[number];
/** Product authority: upstream discovery must never enable host-code or file tools. */
const allowedBrowserTools = [
  "browser_navigate",
  "browser_navigate_back",
  "browser_tabs",
  "browser_snapshot",
  "browser_take_screenshot",
  "browser_click",
  "browser_drag",
  "browser_hover",
  "browser_type",
  "browser_press_key",
  "browser_fill_form",
  "browser_select_option",
  "browser_resize",
  "browser_handle_dialog",
  "browser_close",
  "browser_wait_for",
  "browser_console_messages",
  "browser_network_requests",
  "browser_evaluate",
] as const;
const browserToolName = z.enum(allowedBrowserTools);
export const isAllowedBrowserTool = (name: unknown): name is (typeof allowedBrowserTools)[number] =>
  typeof name === "string" && (allowedBrowserTools as readonly string[]).includes(name);

const browserRequest = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("status") }),
  z.strictObject({ action: z.literal("set-mode"), mode: z.enum(browserModes) }),
  z.strictObject({ action: z.literal("list-tools") }),
  z.strictObject({
    action: z.literal("call"),
    name: browserToolName,
    arguments: z.record(z.string(), z.json()),
  }),
  z.strictObject({ action: z.literal("close") }),
]);
type BrowserRequest = z.infer<typeof browserRequest>;
export function parseBrowserRequest(value: unknown): BrowserRequest {
  try {
    return parseValue(browserRequest, value);
  } catch {
    throw new Error("Invalid browser request");
  }
}

export const BROWSER_TOOL = {
  kind: "browser" as const,
  name: "code60_browser" as const,
  title: "Use browser",
  description:
    "Automate websites in this dispatched chat turn. Default mode is headless; set-mode selects headless, visible (a separate window), or existing-browser (the user's Chrome tabs through the Playwright extension). Follow a preference stated in chat. Switching mode closes the previous connection and loses isolated browser state. Use list-tools to discover allowed Playwright signatures, then call with the exact name and arguments. Host-code, installation, file-upload and page-registered WebMCP tools are not exposed. status and set-mode do not launch anything; list-tools/call may download the pinned Playwright MCP package. Existing Browser requires Chrome, the extension and its connection approval; never silently fall back. close releases the connection. Browser actions can submit forms or delete website data and are not reversed by message Undo. This does not control native desktop apps.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: browserRequest.options.map((option) => option.shape.action.value),
      },
      mode: {
        type: "string",
        enum: browserModes,
        description: "Required only for set-mode. The selection lasts for this live conversation.",
      },
      name: z.toJSONSchema(browserToolName),
      arguments: {
        type: "object",
        additionalProperties: true,
        description: "Required only for call. Use the schema returned by list-tools.",
      },
    },
    required: ["action"],
    additionalProperties: false as const,
  },
  readOnly: false,
  destructive: true,
};
