import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import type { McpConfigurationStore as StoreType } from "../src/application/index.js";
import { openMcpServers } from "./fixtures/browser-actions.js";
import { browserApp, createDatabase, onboard, openProject } from "./fixtures/browser-app.js";

const original =
  '{"version":1,"servers":{"docs":{"label":"Private definition","enabled":false,"type":"stdio","command":"never-run","args":[],"env":{"PRIVATE_TOKEN":{"credentialRef":"private-reference"}}}}}\n';
async function app(page: Page) {
  await openMcpServers(page);
  await expect(page.getByRole("tab", { name: "User", exact: true })).toBeVisible();
}
async function edit(page: Page, value: string) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((text) => navigator.clipboard.writeText(text), value);
  await page.locator(".mcp-json-editor .inputarea").focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+v");
}
for (const direction of ["complete", "roll back", "conflict"] as const) {
  test(`MCP recovery: reviewed interrupted move ${direction}, draft retention and private evidence`, async ({
    browser,
  }) => {
    const fixture = await browserApp(browser);
    const userFile = join(fixture.directory, "config/code60/mcp.json");
    const project = join(fixture.directory, "project");
    const projectFile = join(project, ".code60/mcp.json");
    const stateRoot = join(fixture.directory, "state/code60/mcp-configuration");
    try {
      await fs.mkdir(project);
      await fs.writeFile(userFile, original, { mode: 0o600 });
      const { page } = await fixture.open();
      await onboard(page);
      await createDatabase(page, fixture.directory);
      await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
      await openProject(page, fixture.directory, "project");
      await fixture.gateway.stop();
      const { McpConfigurationStore } = (await import(
        pathToFileURL(resolve("dist/application/index.js")).href
      )) as { McpConfigurationStore: typeof StoreType };
      const store = await McpConfigurationStore.open({
        stateRoot,
        userDirectory: join(fixture.directory, "config/code60"),
        io: {
          ...fs,
          checkpoint: async (step) => {
            if (step === "directory-sync") throw new Error("synthetic interrupted move");
          },
        },
      });
      try {
        const user = store.targetIds()[0]!.targetId;
        const target = await store.registerProject(project);
        expect(
          (
            await store.move({
              sourceId: user,
              destinationId: target,
              serverId: "docs",
              expectedSourceRevision: (await store.read(user)).revision,
              expectedDestinationRevision: (await store.read(target)).revision,
              requestId: randomUUID(),
            })
          ).status,
        ).toBe("recovery-required");
      } finally {
        await store.close();
      }
      const pendingBytes = [await fs.readFile(userFile), await fs.readFile(projectFile)];
      await fixture.restart();
      const { page: recovered } = await fixture.open();
      await expect(recovered.getByRole("banner", { name: "Code60" })).toBeVisible();
      await app(recovered);
      expect(await fs.readFile(userFile)).toEqual(pendingBytes[0]);
      expect(await fs.readFile(projectFile)).toEqual(pendingBytes[1]);
      await recovered.getByRole("button", { name: "Edit JSON", exact: true }).click();
      const jsonModal = recovered.getByRole("dialog", { name: /^Edit JSON —/ });
      await edit(recovered, original.replace("Private definition", "Blocked recovery edit"));
      await expect(jsonModal.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      await jsonModal.getByRole("button", { name: "Cancel", exact: true }).click();
      await recovered.getByRole("button", { name: "Configuration recovery", exact: true }).click();
      const dialog = recovered.getByRole("dialog", {
        name: "MCP configuration recovery",
        exact: true,
      });
      await dialog.getByRole("button", { name: "Review transaction", exact: true }).click();
      await expect(dialog).toContainText("Current state: after");
      await expect(dialog).toContainText("Current state: before");
      await expect(dialog).not.toContainText("private-reference");
      await dialog.getByRole("button", { name: "Complete transaction", exact: true }).click();
      await dialog.getByRole("button", { name: "Cancel recovery", exact: true }).click();
      expect(await fs.readFile(userFile)).toEqual(pendingBytes[0]);
      expect(await fs.readFile(projectFile)).toEqual(pendingBytes[1]);
      if (direction === "conflict") {
        await fs.writeFile(userFile, original + " ");
        await dialog.getByRole("button", { name: "Complete transaction", exact: true }).click();
        await dialog.getByRole("button", { name: "Confirm complete", exact: true }).click();
        await expect(dialog).toContainText("MCP_RECOVERY_BLOCKED");
        await dialog
          .getByRole("button", { name: "Refresh recovery evidence", exact: true })
          .click();
        await dialog.getByRole("button", { name: "Review transaction", exact: true }).click();
        await expect(dialog).toContainText("MCP_RECOVERY_CONFLICT");
        await expect(
          dialog.getByRole("button", { name: "Complete transaction", exact: true }),
        ).toBeDisabled();
        expect(await fs.readFile(userFile, "utf8")).toBe(original + " ");
        expect((await fs.readdir(stateRoot)).some((f) => f.endsWith(".journal"))).toBe(true);
      } else {
        await dialog
          .getByRole("button", {
            name: direction === "complete" ? "Complete transaction" : "Roll back transaction",
            exact: true,
          })
          .click();
        await dialog.getByRole("button", { name: `Confirm ${direction}`, exact: true }).click();
        await expect(dialog).toContainText("Recovery verified");
        expect(JSON.parse(await fs.readFile(userFile, "utf8")).servers).toEqual(
          direction === "complete" ? {} : JSON.parse(original).servers,
        );
        if (direction === "complete")
          expect(JSON.parse(await fs.readFile(projectFile, "utf8")).servers).toEqual(
            JSON.parse(original).servers,
          );
        else await expect(fs.stat(projectFile)).rejects.toThrow();
        expect((await fs.readdir(stateRoot)).some((f) => f.endsWith(".journal"))).toBe(false);
        for (const file of (await fs.readdir(stateRoot)).filter((f) => f.endsWith(".backup")))
          expect((await fs.stat(join(stateRoot, file))).mode & 0o777).toBe(0o600);
      }
      await dialog.getByRole("button", { name: "Close recovery", exact: true }).click();
      await expect(dialog).toHaveCount(0);
    } finally {
      await fixture.close();
    }
  });
}
test("MCP troubleshooting: review/copy allowlisted report and explicit cleanup without launching commands", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  try {
    const file = join(fixture.directory, "config/code60/mcp.json");
    await fs.writeFile(file, original, { mode: 0o600 });
    const { page } = await fixture.open();
    await onboard(page);
    await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await app(page);
    await page.getByRole("button", { name: "Review troubleshooting report", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "Safe MCP troubleshooting report",
      exact: true,
    });
    const report = JSON.parse(await dialog.locator("pre").innerText());
    expect(report).toMatchObject({
      version: 1,
      scope: "user",
      configuration: "valid",
      definitions: 1,
      enabled: 0,
      connections: { notTested: 1 },
      authentication: { notChecked: 1 },
    });
    expect(JSON.stringify(report)).not.toMatch(
      /private-reference|Private definition|never-run|PRIVATE_TOKEN|url|path|targetId|command/,
    );
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await dialog.getByRole("button", { name: "Copy safe report", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(JSON.stringify(report, null, 2));
    await dialog.getByRole("button", { name: "Close report", exact: true }).click();
    await page.getByRole("button", { name: "Verify cleanup", exact: true }).click();
    const cleanup = page.getByRole("dialog", { name: "Verify owned MCP cleanup?", exact: true });
    await cleanup.getByRole("button", { name: "Cancel cleanup verification", exact: true }).click();
    await page.getByRole("button", { name: "Verify cleanup", exact: true }).click();
    await cleanup
      .getByRole("button", { name: "Confirm cleanup verification", exact: true })
      .click();
    await expect(page.locator("#panel-mcp-servers")).toContainText("Owned cleanup verified");
    expect(await fs.readFile(file, "utf8")).toBe(original);
    expect(
      (await fs.readdir(join(fixture.directory, "state/code60/mcp-configuration"))).filter((f) =>
        /\.(journal|backup)$/.test(f),
      ),
    ).toEqual([]);
    await page.reload();
    await app(page);
    await page.getByRole("button", { name: "Review troubleshooting report", exact: true }).click();
    await expect(dialog.locator("pre")).toContainText('"notTested": 1');
  } finally {
    await fixture.close();
  }
});

test("MCP troubleshooting: jump to malformed JSON, repair, and preserve draft after unsafe write", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  const file = join(fixture.directory, "config/code60/mcp.json");
  const storage = join(fixture.directory, "state/code60/mcp-configuration");
  const malformed = '{"version":1,"servers":{},"PRIVATE_UNKNOWN":"PRIVATE_VALUE",';
  try {
    await fs.writeFile(file, malformed, { mode: 0o600 });
    const { page } = await fixture.open();
    await onboard(page);
    await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await app(page);
    await page.getByRole("button", { name: "Edit JSON", exact: true }).click();
    let jsonModal = page.getByRole("dialog", { name: /^Edit JSON —/ });
    const issues = jsonModal.getByRole("list", { name: "Configuration issues", exact: true });
    await expect(issues).toBeVisible();
    await expect(issues).toHaveCSS("list-style-type", "none");
    await expect(issues).not.toContainText("PRIVATE_UNKNOWN");
    await expect(issues).not.toContainText("PRIVATE_VALUE");
    await issues.getByRole("button").first().click();
    await expect(jsonModal.locator(".mcp-json-editor .inputarea")).toBeFocused();
    await expect(jsonModal.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await edit(page, original);
    await jsonModal.getByRole("button", { name: "Save", exact: true }).click();
    await expect(jsonModal).toHaveCount(0);
    await expect.poll(() => fs.readFile(file, "utf8")).toBe(original);
    const backups = (await fs.readdir(storage)).filter((f) => f.endsWith(".backup"));
    expect(backups.length).toBe(1);
    expect(await fs.readFile(join(storage, backups[0]!), "utf8")).toContain(
      Buffer.from(malformed).toString("base64"),
    );
    await fs.chmod(file, 0o400);
    await page.getByRole("button", { name: "Edit JSON", exact: true }).click();
    jsonModal = page.getByRole("dialog", { name: /^Edit JSON —/ });
    const next = original.replace("Private definition", "Blocked unsafe write");
    await edit(page, next);
    await jsonModal.getByRole("button", { name: "Save", exact: true }).click();
    await expect(jsonModal).toContainText("MCP_CONFIG_UNSAFE");
    await expect(jsonModal.locator(".mcp-json-editor")).toContainText("Blocked unsafe write");
    expect(await fs.readFile(file, "utf8")).toBe(original);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o400);
    expect((await fs.readdir(storage)).filter((f) => f.endsWith(".backup"))).toEqual(backups);
    expect((await fs.readdir(storage)).some((f) => f.endsWith(".journal"))).toBe(false);
  } finally {
    await fixture.close();
  }
});

test("MCP recovery: interrupted combined reset rolls back exact malformed preimage after review", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  const userFile = join(fixture.directory, "config/code60/mcp.json");
  const malformed = '{"PRIVATE_RESET_ORIGINAL":"retain exact bytes",';
  const project = join(fixture.directory, "project");
  const projectFile = join(project, ".code60/mcp.json");
  const stateRoot = join(fixture.directory, "state/code60/mcp-configuration");
  try {
    await fs.mkdir(project);
    await fs.mkdir(join(project, ".code60"));
    await fs.writeFile(userFile, malformed, { mode: 0o600 });
    await fs.writeFile(projectFile, original, { mode: 0o644 });
    const { page } = await fixture.open();
    await onboard(page);
    await createDatabase(page, fixture.directory);
    await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await openProject(page, fixture.directory, "project");
    await fixture.gateway.stop();
    const { McpConfigurationStore } = (await import(
      pathToFileURL(resolve("dist/application/index.js")).href
    )) as { McpConfigurationStore: typeof StoreType };
    const store = await McpConfigurationStore.open({
      stateRoot,
      userDirectory: join(fixture.directory, "config/code60"),
      io: {
        ...fs,
        checkpoint: async (step) => {
          if (step === "directory-sync") throw new Error("synthetic reset interruption");
        },
      },
    });
    try {
      const user = store.targetIds()[0]!.targetId;
      const target = await store.registerProject(project);
      expect(
        (
          await store.reset({
            requestId: randomUUID(),
            targets: [
              { targetId: user, expectedRevision: (await store.read(user)).revision, reset: true },
              {
                targetId: target,
                expectedRevision: (await store.read(target)).revision,
                reset: true,
              },
            ],
          })
        ).status,
      ).toBe("recovery-required");
    } finally {
      await store.close();
    }
    expect(JSON.parse(await fs.readFile(userFile, "utf8")).servers).toEqual({});
    expect(await fs.readFile(projectFile, "utf8")).toBe(original);
    await fixture.restart();
    const { page: recovered } = await fixture.open();
    await expect(recovered.getByRole("banner", { name: "Code60" })).toBeVisible();
    await app(recovered);
    await recovered.getByRole("button", { name: "Configuration recovery", exact: true }).click();
    const dialog = recovered.getByRole("dialog", {
      name: "MCP configuration recovery",
      exact: true,
    });
    await dialog.getByRole("button", { name: "Review transaction", exact: true }).click();
    await expect(dialog).toContainText("Recorded operation: reset");
    await expect(dialog).toContainText(
      "Malformed file (rollback restores its exact original bytes)",
    );
    await expect(dialog).toContainText("Changing User configuration affects other projects");
    await expect(dialog).not.toContainText("PRIVATE_RESET_ORIGINAL");
    await dialog.getByRole("button", { name: "Roll back transaction", exact: true }).click();
    await dialog.getByRole("button", { name: "Confirm roll back", exact: true }).click();
    await expect(dialog).toContainText("Recovery verified");
    expect(await fs.readFile(userFile, "utf8")).toBe(malformed);
    expect(await fs.readFile(projectFile, "utf8")).toBe(original);
    expect((await fs.stat(userFile)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(projectFile)).mode & 0o777).toBe(0o644);
    expect((await fs.readdir(stateRoot)).some((f) => f.endsWith(".journal"))).toBe(false);
  } finally {
    await fixture.close();
  }
});

test("MCP troubleshooting: launch-stage warning and explicit bounded discovery retry", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  const file = join(fixture.directory, "config/code60/mcp.json");
  try {
    const document = JSON.parse(original);
    document.servers.docs.env = {};
    const bytes = JSON.stringify(document);
    await fs.writeFile(file, bytes, { mode: 0o600 });
    const { page } = await fixture.open();
    await onboard(page);
    await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await app(page);
    for (let attempt = 0; attempt < 2; attempt++) {
      await page
        .getByRole("button", { name: /^Actions for / })
        .first()
        .click();
      await page.getByRole("menuitem", { name: "Test connection", exact: true }).click();
      const confirm = page.getByRole("dialog", { name: "Test MCP server?", exact: true });
      await expect(confirm).toContainText("Only initialization and tool discovery");
      await confirm.getByRole("button", { name: "Test connection", exact: true }).click();
      const testDialog = page.getByRole("dialog", { name: /^Test connection —/ });
      await expect(testDialog).toContainText("MCP_LAUNCH (launch)");
      await expect(testDialog).toContainText("Other tools remain available");
      await testDialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(testDialog).toHaveCount(0);
    }
    await page.getByRole("button", { name: "Review troubleshooting report", exact: true }).click();
    const report = page.getByRole("dialog", {
      name: "Safe MCP troubleshooting report",
      exact: true,
    });
    expect(JSON.parse(await report.locator("pre").innerText())).toMatchObject({
      failures: [{ code: "launch", stage: "launch" }],
      connections: { failed: 1 },
      unresolvedCleanup: 0,
    });
    await expect(report.locator("pre")).not.toContainText("never-run");
    expect(await fs.readFile(file, "utf8")).toBe(bytes);
  } finally {
    await fixture.close();
  }
});

test("MCP troubleshooting: uncertain HTTP cleanup stays revoked until explicit verification succeeds", async ({
  browser,
}) => {
  const remote = createServer(async (request, response) => {
    if (request.method === "DELETE") {
      deletes++;
      response.writeHead(allowCleanup ? 204 : 500).end();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    let text = "";
    for await (const chunk of request) text += chunk;
    const message = JSON.parse(text);
    if (message.method === "initialize") initializes++;
    if (message.method === "tools/list") lists++;
    if (message.method === "tools/call") calls++;
    if (message.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    const result =
      message.method === "initialize"
        ? {
            protocolVersion: message.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "synthetic-cleanup", version: "1" },
          }
        : message.method === "tools/list"
          ? { tools: [{ name: "synthetic", inputSchema: { type: "object" } }] }
          : { content: [] };
    response
      .writeHead(200, {
        "Content-Type": "application/json",
        "Mcp-Session-Id": "synthetic-cleanup-session",
      })
      .end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  let allowCleanup = false,
    deletes = 0,
    initializes = 0,
    lists = 0,
    calls = 0;
  await new Promise<void>((resolve) => remote.listen(0, "127.0.0.1", resolve));
  const address = remote.address();
  if (!address || typeof address === "string") throw new Error("missing fixture address");
  let fixture: Awaited<ReturnType<typeof browserApp>> | undefined;
  try {
    fixture = await browserApp(browser);
    const file = join(fixture.directory, "config/code60/mcp.json");
    const bytes = JSON.stringify({
      version: 1,
      servers: {
        fixture: {
          label: "Cleanup fixture",
          type: "http",
          enabled: false,
          url: `http://127.0.0.1:${address.port}/mcp`,
        },
      },
    });
    await fs.writeFile(file, bytes, { mode: 0o600 });
    const { page } = await fixture.open();
    await onboard(page);
    await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await app(page);
    await page
      .getByRole("button", { name: /^Actions for / })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Test connection", exact: true }).click();
    const testDialog = page.getByRole("dialog", { name: /^Test connection —/ });
    await expect(testDialog).toContainText("cleanup could not be verified");
    await testDialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(testDialog).toHaveCount(0);
    expect({ initializes, lists, calls, deletes }).toEqual({
      initializes: 1,
      lists: 1,
      calls: 0,
      deletes: 1,
    });
    await page.getByRole("button", { name: "Review troubleshooting report", exact: true }).click();
    const report = page.getByRole("dialog", {
      name: "Safe MCP troubleshooting report",
      exact: true,
    });
    expect(JSON.parse(await report.locator("pre").innerText()).unresolvedCleanup).toBe(1);
    await report.getByRole("button", { name: "Close report", exact: true }).click();
    const verify = async () => {
      await page.getByRole("button", { name: "Verify cleanup", exact: true }).click();
      await page
        .getByRole("dialog", { name: "Verify owned MCP cleanup?", exact: true })
        .getByRole("button", { name: "Confirm cleanup verification", exact: true })
        .click();
    };
    await verify();
    await expect(page.locator("#panel-mcp-servers")).toContainText(
      "Owned cleanup remains unresolved",
    );
    expect(deletes).toBe(2);
    allowCleanup = true;
    await verify();
    await expect(page.locator("#panel-mcp-servers")).toContainText("Owned cleanup verified");
    expect({ initializes, lists, calls, deletes }).toEqual({
      initializes: 1,
      lists: 1,
      calls: 0,
      deletes: 3,
    });
    expect(await fs.readFile(file, "utf8")).toBe(bytes);
  } finally {
    allowCleanup = true;
    await fixture?.close();
    remote.closeAllConnections();
    await new Promise<void>((resolve) => remote.close(() => resolve()));
  }
});
