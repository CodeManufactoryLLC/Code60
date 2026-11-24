import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { MCP_CONNECTOR_TEMPLATES, type McpConnectorDocument } from "../bridge/index.js";
import { McpForm, mcpFormDocument, mcpFormFields } from "./mcp-form.js";

const base: McpConnectorDocument = {
  version: 1,
  servers: {
    docs: {
      type: "http",
      enabled: true,
      label: "Docs",
      url: "https://example.com/mcp",
      headers: { "X-Service-Token": { credentialRef: "token", prefix: "Bearer " } },
      auth: {
        type: "oauth",
        scopes: ["read"],
        clientId: "client",
        clientSecretRef: "registration",
      },
    },
  },
};
it("round-trips supported HTTP registration/bindings while preserving enabled state and unrelated entries", () => {
  const fields = mcpFormFields("docs", base.servers.docs);
  fields.label = "Renamed";
  const result = mcpFormDocument(fields, base, "docs");
  expect(result.servers.docs).toEqual({ ...base.servers.docs, label: "Renamed" });
  expect(base.servers.docs?.label).toBe("Docs");
  expect(() => mcpFormDocument(fields, base)).toThrow("already exists");
});
it("creates disabled stdio definitions, preserves empty arguments and rejects duplicate bindings and reserved IDs", () => {
  const fields = mcpFormFields("new");
  fields.label = "New";
  fields.command = "node";
  fields.args = ["", "with spaces"];
  fields.env = [{ key: "token", name: "TOKEN", kind: "credential", value: "token", prefix: "" }];
  expect(mcpFormDocument(fields, base).servers.new).toMatchObject({
    enabled: false,
    args: ["", "with spaces"],
    env: { TOKEN: { credentialRef: "token" } },
  });
  fields.env.push({
    key: "duplicate",
    name: "TOKEN",
    kind: "literal",
    value: "public",
    prefix: "",
  });
  expect(() => mcpFormDocument(fields, base)).toThrow("Binding names must be unique");
  fields.env = [];
  fields.id = "code60";
  expect(() => mcpFormDocument(fields, base)).toThrow("Invalid MCP connector configuration");
});
it("provides labelled guided fields, unverified credential guidance and stale-save protection without activation controls", () => {
  const html = renderToStaticMarkup(
    <McpForm
      initial={mcpFormFields("docs", base.servers.docs)}
      base={base}
      originalId="docs"
      templates={MCP_CONNECTOR_TEMPLATES}
      busy={false}
      stale
      onSave={() => {}}
      onCancel={() => {}}
      onReload={() => {}}
    />,
  );
  expect(html).toContain('aria-label="Headers prefix 1"');
  expect(html).toContain("Credential references are unverified");
  expect(html).toContain("Reload before saving");
  expect(html).toMatch(/type="submit" disabled/);
  expect(html).not.toContain("Sign in");
  expect(html).not.toContain("Test connection");
});

it("blocks a document exceeding the UTF-8 byte budget even when every argument meets its character limit", () => {
  const fields = mcpFormFields("large");
  fields.label = "Large";
  fields.command = "node";
  fields.args = Array.from({ length: 128 }, () => "é".repeat(4096));
  expect(() => mcpFormDocument(fields, base)).toThrow("1 MiB UTF-8 limit");
  expect(Object.keys(base.servers)).toEqual(["docs"]);
});
it("restores incomplete guided fields and paste errors from renderer memory without creating a definition", () => {
  const fields = mcpFormFields("unfinished");
  fields.label = "Incomplete draft";
  fields.command = "";
  fields.args = ["", "partial argument"];
  fields.argIds = ["empty-row", "partial-row"];
  const html = renderToStaticMarkup(
    <McpForm
      initial={mcpFormFields("blank")}
      base={base}
      templates={MCP_CONNECTOR_TEMPLATES}
      draft={{ fields, paste: "{incomplete", pasteOpen: true, error: "Invalid server definition." }}
      busy={false}
      stale={false}
      onSave={() => {}}
      onCancel={() => {}}
      onReload={() => {}}
    />,
  );
  expect(html).toContain("Incomplete draft");
  expect(html).toContain("partial argument");
  expect(html).toContain("{incomplete");
  expect(html).toContain("Invalid server definition.");
  expect(base.servers.unfinished).toBeUndefined();
});

it("rejects OAuth/Authorization conflicts and supports explicit metadata URL registration", () => {
  const fields = mcpFormFields("docs", base.servers.docs);
  fields.headers[0]!.name = "Authorization";
  expect(() => mcpFormDocument(fields, base, "docs")).toThrow(
    "Invalid MCP connector configuration",
  );
  fields.headers = [];
  fields.clientIdType = "metadata-url";
  fields.clientId = "https://client.example/metadata.json";
  fields.clientSecretRef = "";
  expect(mcpFormDocument(fields, base, "docs").servers.docs).toMatchObject({
    auth: { type: "oauth", clientIdType: "metadata-url", clientId: fields.clientId },
  });
  fields.clientId = "http://client.example/metadata.json";
  expect(() => mcpFormDocument(fields, base, "docs")).toThrow(
    "Invalid MCP connector configuration",
  );
});
