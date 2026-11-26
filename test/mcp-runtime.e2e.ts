import { mkdir, open, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { openMcpServers } from "./fixtures/browser-actions.js";
import { browserApp, createDatabase, onboard, openProject } from "./fixtures/browser-app.js";

async function apps(page: Page) {
  await openMcpServers(page);
  await expect(page.getByLabel("Configuration", { exact: true })).toBeVisible();
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
test("MCP runtime: future enablement, test confirmation, approval, disconnect and idle reconnect preserve JSON drafts", async ({
  browser,
}) => {
  const fixture = await browserApp(browser, ["--relay", "--session-info", "--restore"]);
  try {
    const evidence = join(fixture.directory, "upstream.jsonl");
    const document = {
      version: 1,
      servers: {
        fixture: {
          label: "Fixture tools",
          enabled: false,
          type: "stdio",
          command: process.execPath,
          args: [resolve("test/fixtures/mcp-upstream.mjs")],
          env: { MCP_EVIDENCE: { value: evidence } },
        },
      },
    };
    // Original starting state: optional definitions exist but no verified provider or active server.
    const userFile = join(fixture.directory, "config/code60/mcp.json");
    await writeFile(userFile, `${JSON.stringify(document)}\n`, { mode: 0o600 });
    const { page } = await fixture.open();
    await onboard(page);
    await createDatabase(page, fixture.directory);
    await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await apps(page);
    const serverAction = async (action: string) => {
      await page
        .getByRole("button", { name: /^Actions for / })
        .first()
        .click();
      await page.getByRole("menuitem", { name: action, exact: true }).click();
    };
    await serverAction("Enable server");
    await expect(page.locator(".mcp-workspace").getByRole("table")).toContainText("Yes");
    expect(JSON.parse(await readFile(userFile, "utf8")).servers.fixture.enabled).toBe(true);
    await expect(stat(evidence)).rejects.toThrow();
    await serverAction("Test connection");
    const confirmation = page.getByRole("dialog", { name: "Test MCP server?", exact: true });
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(stat(evidence)).rejects.toThrow();
    await serverAction("Test connection");
    await confirmation.getByRole("button", { name: "Test connection", exact: true }).click();
    await expect(page.getByLabel("MCP connection controls")).toContainText("1 tools discovered");
    const events = async () =>
      (await readFile(evidence, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    expect((await events()).map((event) => event.event)).toEqual(["spawn", "list"]);
    await expect.poll(async () => alive((await events())[0].pid)).toBe(false);
    await mkdir(join(fixture.directory, "project"));
    await openProject(page, fixture.directory, "project");
    await apps(page);
    await expect(page.getByLabel("MCP connection controls")).toContainText("connected");
    const before = (await events()).filter((event) => event.event === "spawn").length;
    await page
      .getByRole("button", { name: "Reconnect session servers", exact: true })
      .first()
      .click();
    let decision = page.getByRole("dialog", { name: "Reconnect session servers", exact: true });
    await expect(decision).toContainText("fixture");
    await decision.getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await events()).filter((event) => event.event === "spawn")).toHaveLength(before);
    await page
      .getByRole("button", { name: "Reconnect session servers", exact: true })
      .first()
      .click();
    await decision
      .getByRole("button", { name: "Confirm reconnect session servers", exact: true })
      .click();
    await expect(decision).toHaveCount(0);
    await expect
      .poll(async () => (await events()).filter((event) => event.event === "spawn").length)
      .toBe(before + 1);
    await page.getByRole("button", { name: "Relay", exact: true }).click();
    const chat = page.locator(".orchestration-chat-page:visible");
    const composer = chat.getByRole("textbox", { name: "Message to orchestrator", exact: true });
    await composer.fill(
      JSON.stringify([{ message: "MCP turn is active" }, { hang: "cancellable" }]),
    );
    await composer.press("Enter");
    await expect(chat).toContainText("MCP turn is active");
    await expect(chat.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
    const relayId = (await page.evaluate(() => window.code60.snapshot())).chat.run?.id;
    if (!relayId) throw new Error("Relay session missing");
    await apps(page);
    const liveSession = page.getByRole("group", {
      name: `Session ${relayId}`,
      exact: true,
    });
    await expect(liveSession).toContainText("Active");
    await liveSession
      .getByRole("button", { name: "Reconnect session servers", exact: true })
      .click();
    await expect(page.getByLabel("MCP connection controls")).toContainText(
      "Reconnect requires an idle session",
    );
    expect((await events()).filter((event) => event.event === "spawn")).toHaveLength(before + 1);
    const savedConfiguration = await readFile(userFile);
    await writeFile(userFile, '{"version":1,"servers":', { mode: 0o600 });
    await page.getByRole("button", { name: "Review troubleshooting report", exact: true }).click();
    const troubleshooting = page.getByRole("dialog", {
      name: "Safe MCP troubleshooting report",
      exact: true,
    });
    const report = JSON.parse(await troubleshooting.locator("pre").innerText());
    expect(report.configuration).toBe("invalid");
    expect(report.capturedInstances).toBeGreaterThan(0);
    expect(report.connectedInstances).toBeGreaterThan(0);
    await troubleshooting.getByRole("button", { name: "Close report", exact: true }).click();
    await writeFile(userFile, savedConfiguration);
    await apps(page);
    await page.getByRole("button", { name: "Relay", exact: true }).click();
    await chat.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(composer).toBeEditable();
    await apps(page);
    await page.getByRole("button", { name: "Disconnect server", exact: true }).first().click();
    decision = page.getByRole("dialog", { name: "Disconnect server", exact: true });
    await decision.getByRole("button", { name: "Confirm disconnect server", exact: true }).click();
    await expect(decision).toHaveCount(0);
    const configuration = await open(userFile, "r");
    try {
      expect(JSON.parse(await configuration.readFile("utf8")).servers.fixture.enabled).toBe(true);
      expect((await configuration.stat()).mode & 0o777).toBe(0o600);
    } finally {
      await configuration.close();
    }
    await serverAction("Disable server");
    await expect(page.locator(".mcp-workspace").getByRole("table")).toContainText("No");
    const projectValue = await page
      .getByLabel("Configuration", { exact: true })
      .locator("option")
      .filter({ hasText: "project" })
      .getAttribute("value");
    if (!projectValue) throw new Error("Project target missing");
    await page.getByLabel("Configuration", { exact: true }).selectOption(projectValue);
    // Add a disabled project override; approval is explicit and source identity remains canonical.
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    const form = page.getByRole("dialog", { name: /Add MCP server/ });
    await form.getByLabel("Server ID", { exact: true }).fill("fixture");
    await form.getByLabel("Label", { exact: true }).fill("Project override");
    await form.getByLabel("Command", { exact: true }).fill("must-not-run");
    await form.getByRole("button", { name: "Save server", exact: true }).click();
    await expect(form).toHaveCount(0);
    await page.getByRole("button", { name: "Review project approval", exact: true }).click();
    decision = page.getByRole("dialog", { name: "Approve project configuration", exact: true });
    await expect(decision).toContainText("must-not-run");
    await decision
      .getByRole("button", { name: "Confirm approve project configuration", exact: true })
      .click();
    await expect(page.getByRole("button", { name: "Revoke approval", exact: true })).toBeVisible();
    expect((await stat(join(fixture.directory, "project/.code60/mcp.json"))).mode & 0o777).toBe(
      0o644,
    );
    const metadata = JSON.parse(
      await readFile(join(fixture.directory, "state/code60/mcp-runtime/trust.json"), "utf8"),
    );
    expect(Object.keys(metadata.approvals)).toHaveLength(1);
    await page.getByRole("tab", { name: "JSON", exact: true }).click();
    await page.locator(".mcp-json-editor .inputarea").focus();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.insertText(" ");
    await page.getByRole("link", { name: "Code60", exact: true }).click();
    await apps(page);
    await expect(page.locator(".mcp-json-editor")).toContainText("Project override");
    await expect(
      page.getByRole("button", { name: "Save configuration", exact: true }),
    ).toBeEnabled();
    const records = await readdir(join(fixture.directory, "state/code60/mcp-configuration"));
    expect(records.some((record) => record.endsWith(".backup"))).toBe(true);
    expect((await events()).some((event) => event.event === "call")).toBe(false);
  } finally {
    await fixture.close();
  }
});

test("MCP runtime: Cancel and browser detach stop page-owned discovery processes without calling tools", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  try {
    const evidence = join(fixture.directory, "slow-upstream.jsonl");
    await writeFile(
      join(fixture.directory, "config/code60/mcp.json"),
      JSON.stringify({
        version: 1,
        servers: {
          slow: {
            label: "Slow synthetic server",
            enabled: false,
            type: "stdio",
            command: process.execPath,
            args: [resolve("test/fixtures/mcp-upstream.mjs")],
            env: { MCP_EVIDENCE: { value: evidence }, MCP_WAIT_BEFORE_DISCOVERY: { value: "1" } },
          },
        },
      }),
      { mode: 0o600 },
    );
    const { page, context } = await fixture.open();
    await onboard(page);
    await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await apps(page);
    const events = async () =>
      (await readFile(evidence, "utf8").catch(() => ""))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    const begin = async () => {
      await page
        .getByRole("button", { name: /^Actions for / })
        .first()
        .click();
      await page.getByRole("menuitem", { name: "Test connection", exact: true }).click();
      await page
        .getByRole("dialog", { name: "Test MCP server?", exact: true })
        .getByRole("button", { name: "Test connection", exact: true })
        .click();
    };
    await begin();
    await expect
      .poll(async () => (await events()).filter((event) => event.event === "list").length)
      .toBe(1);
    await page.getByRole("button", { name: "Cancel connection test", exact: true }).click();
    await expect(page.getByLabel("MCP connection controls")).toContainText("cancelled");
    await expect
      .poll(async () => alive((await events()).find((event) => event.event === "spawn").pid))
      .toBe(false);
    await begin();
    await expect
      .poll(async () => (await events()).filter((event) => event.event === "list").length)
      .toBe(2);
    await context.close();
    await expect
      .poll(
        async () =>
          (await events())
            .filter((event) => event.event === "spawn")
            .every((event) => !alive(event.pid)),
        { timeout: 10_000 },
      )
      .toBe(true);
    expect((await events()).some((event) => event.event === "call")).toBe(false);
    expect((await fetch(fixture.gateway.origin)).status).toBe(200);
  } finally {
    await fixture.close();
  }
});
