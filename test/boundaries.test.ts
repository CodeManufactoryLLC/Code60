import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  application: ["core", "bridge", "platform", "automation"],
  gateway: ["application", "automation", "bridge", "contracts", "core", "platform", "agents"],
  management: ["gateway", "platform", "core", "contracts"],
  automation: ["core", "contracts", "platform"],
  renderer: ["bridge", "core"],
  bridge: ["core", "contracts"],
  core: ["agents", "git", "contracts", "platform"],
  agents: ["contracts", "platform"],
  contracts: [],
  git: ["platform"],
  platform: [],
};

/** Packages only one module may import, so integrations stay in their module. */
const PACKAGE_OWNERS: Readonly<Record<string, string>> = {
  "@agentclientprotocol/sdk": "agents",
  "@modelcontextprotocol/sdk": "agents",
  "@napi-rs/keyring": "platform",
  react: "renderer",
  "react-dom": "renderer",
  "react-markdown": "renderer",
  "remark-gfm": "renderer",
  "@carbon/react": "renderer",
  "@headless-tree/core": "renderer",
  "@headless-tree/react": "renderer",
  "monaco-editor": "renderer",
};

const IMPORT_RE =
  /(?:import|export)\s+(?:[^"'`]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

interface SourceFile {
  path: string;
  text: string;
}

function moduleOf(path: string): string | undefined {
  const [first, second] = relative(SRC, path).split(sep);
  return second === undefined ? undefined : first;
}

function findViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const from = moduleOf(file.path);
    if (from === undefined) {
      violations.push(`${file.path}: files must live inside a module directory`);
      continue;
    }
    for (const match of file.text.matchAll(IMPORT_RE)) {
      const spec = match[1] ?? match[2];
      if (spec === undefined) continue;
      const where = `${relative(SRC, file.path).split(sep).join("/")} imports "${spec}"`;
      if (
        (from === "renderer" || from === "bridge" || from === "contracts") &&
        spec.startsWith("node:")
      )
        violations.push(`${where}: renderer contracts may not import Node.js`);
      if (spec === "electron" || spec === "electron-updater") {
        violations.push(`${where}: Electron is not part of the browser application`);
        continue;
      }
      if (!spec.startsWith(".")) {
        if (
          from === "contracts" &&
          spec !== "zod" &&
          !(spec === "vitest" && file.path.endsWith(".test.ts"))
        ) {
          violations.push(`${where}: contracts may only import zod`);
        }
        const pkg = Object.keys(PACKAGE_OWNERS).find((p) => spec === p || spec.startsWith(`${p}/`));
        if (pkg !== undefined && PACKAGE_OWNERS[pkg] !== from) {
          violations.push(`${where}: only ${PACKAGE_OWNERS[pkg]} may import ${pkg}`);
        }
        continue;
      }
      if (
        (from === "renderer" || from === "bridge") &&
        spec.includes("core/") &&
        !match[0].match(/^(?:import|export)\s+type\b/)
      ) {
        violations.push(`${where}: core imports must be type-only`);
      }
      const target = resolve(dirname(file.path), spec);
      const to = moduleOf(target);
      if (to === undefined) {
        violations.push(`${where}: imports outside src modules are not allowed`);
      } else if (to !== from) {
        if (!ALLOWED[from]?.includes(to)) {
          violations.push(`${where}: ${from} may not depend on ${to}`);
        } else if (target !== join(SRC, to, "index.js")) {
          violations.push(`${where}: import ${to} through its index.js`);
        }
      }
    }
  }
  return violations;
}

function readSources(dir: string): SourceFile[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.(?:tsx?|cts|mjs)$/.test(e.name))
    .map((e) => {
      const path = join(e.parentPath, e.name);
      return { path, text: readFileSync(path, "utf8") };
    });
}

describe("module boundaries", () => {
  it("allows gateway transport composition while keeping application and browser modules isolated from agents", () => {
    const file = (module: string, spec: string) => ({
      path: join(SRC, module, "connector.ts"),
      text: `import { createAgents } from "${spec}";`,
    });
    expect(findViolations([file("gateway", "../agents/index.js")])).toEqual([]);
    for (const module of ["application", "bridge", "renderer", "contracts"])
      expect(findViolations([file(module, "../agents/index.js")])).not.toEqual([]);
    expect(findViolations([file("gateway", "../agents/acp-client.js")])).not.toEqual([]);
  });
  it("allows only the test runner in colocated schema tests while preserving production and Node boundaries", () => {
    const file = (name: string, text: string) => ({ path: join(SRC, "contracts", name), text });
    expect(findViolations([file("browser.test.ts", 'import { it } from "vitest";')])).toEqual([]);
    expect(findViolations([file("browser.ts", 'import { it } from "vitest";')])).not.toEqual([]);
    expect(
      findViolations([file("browser.test.ts", 'import { readFile } from "node:fs";')]),
    ).not.toEqual([]);
  });
  it("src follows the dependency rules in ARCHITECTURE.md", () => {
    expect(findViolations(readSources(SRC))).toEqual([]);
  });

  it("keeps contracts browser-safe and independent of application modules", () => {
    const f = (text: string) => ({ path: join(SRC, "contracts", "x.ts"), text });
    expect(findViolations([f('import { z } from "zod";')])).toEqual([]);
    expect(findViolations([f('import { readFile } from "node:fs";')])).not.toEqual([]);
    expect(findViolations([f('import type { Config } from "../core/index.js";')])).not.toEqual([]);
    expect(findViolations([f('import { app } from "electron";')])).not.toEqual([]);
  });

  it("keeps native capabilities out of browser modules and platform independent", () => {
    for (const module of ["renderer", "bridge", "contracts"]) {
      expect(
        findViolations([
          {
            path: join(SRC, module, "x.ts"),
            text: 'import { spawnOwnedProcess } from "../platform/index.js";',
          },
        ]),
      ).not.toEqual([]);
    }
    expect(
      findViolations([
        {
          path: join(SRC, "platform", "x.ts"),
          text: 'import { defaultDeps } from "../core/index.js";',
        },
      ]),
    ).not.toEqual([]);
  });

  it("detects forbidden dependencies, deep imports, and owned packages", () => {
    const f = (module: string, text: string) => ({ path: join(SRC, module, "x.ts"), text });
    expect(
      findViolations([
        f("automation", 'import { x } from "../agents/index.js";'),
        f("agents", 'import type { X } from "../core/index.js";'),
        f("git", 'export * from "../agents/index.js";'),
        f("automation", 'import { y } from "../core/run.js";'),
        f("core", 'import { ClientSideConnection } from "@agentclientprotocol/sdk";'),
        f("core", 'const m = await import("../git/index.js");'),
        f("core", 'import { createRoot } from "react-dom";'),
        f("renderer", 'import { useState } from "react";'),
        f("renderer", 'import { app } from "electron";'),
        f("application", 'import { render } from "react-dom";'),
        f("renderer", 'import { defaultDeps } from "../core/index.js";'),
      ]),
    ).toEqual([
      'automation/x.ts imports "../agents/index.js": automation may not depend on agents',
      'agents/x.ts imports "../core/index.js": agents may not depend on core',
      'git/x.ts imports "../agents/index.js": git may not depend on agents',
      'automation/x.ts imports "../core/run.js": import core through its index.js',
      'core/x.ts imports "@agentclientprotocol/sdk": only agents may import @agentclientprotocol/sdk',
      'core/x.ts imports "react-dom": only renderer may import react-dom',
      'renderer/x.ts imports "electron": Electron is not part of the browser application',
      'application/x.ts imports "react-dom": only renderer may import react-dom',
      'renderer/x.ts imports "../core/index.js": core imports must be type-only',
    ]);
  });
});
