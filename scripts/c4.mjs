import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, lstat, mkdir, readdir, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("..", import.meta.url));

export const DEFAULT_STRUCTURIZR_IMAGE =
  "structurizr/structurizr:2026.10.26@sha256:8aebde645a7cc8d3b9e1e774cd6d75a84ce45d74ae70eb783876182fe7db31a2";

const REQUIRED_KB_C4_DOCS = [
  "knowledge/architecture/c4/INDEX.md",
  "knowledge/architecture/c4/context.md",
  "knowledge/architecture/c4/containers.md",
  "knowledge/architecture/c4/components-backend.md",
  "knowledge/architecture/c4/components-renderer.md",
  "knowledge/architecture/c4/runtime-flows.md",
  "knowledge/architecture/c4/deployment.md",
];

const ALLOWED_EXPORT_FORMATS = new Set([
  "mermaid",
  "plantuml",
  "plantuml/c4plantuml",
  "static",
  "json",
  "dot",
]);

const inside = (root, target) => {
  const rel = relative(root, target);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function stripCommentsAndStrings(line) {
  let out = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && inQuotes) {
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes) {
      if (ch === "#") break;
      if (ch === "/" && line[i + 1] === "/") break;
      out += ch;
    }
  }
  return out;
}

function countBraceDelta(text) {
  let depth = 0;
  let minDepth = 0;
  for (const line of text.split(/\r?\n/)) {
    const clean = stripCommentsAndStrings(line);
    for (const ch of clean) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth < minDepth) minDepth = depth;
      }
    }
  }
  return { depth, minDepth };
}

export async function checkC4Architecture(directory = repository) {
  const root = await realpath(directory);
  const dslRoot = resolve(root, "architecture/structurizr");
  if (!(await exists(dslRoot))) return [];

  const failures = [];
  const workspacePath = resolve(dslRoot, "workspace.dsl");
  if (!(await exists(workspacePath))) {
    failures.push("architecture/structurizr/workspace.dsl:1: Missing root Structurizr workspace");
    return failures;
  }

  const visited = new Set();
  const includedFiles = [];
  const declaredModules = new Map();
  const viewKeys = new Map();

  const walkDsl = async (filePath, fromRel) => {
    const rel = relative(root, filePath).split(sep).join("/");
    if (!inside(dslRoot, filePath)) {
      failures.push(`${fromRel}:1: Include "${rel}" escapes architecture/structurizr/`);
      return;
    }
    if (!(await exists(filePath))) {
      failures.push(`${fromRel}:1: Missing !include target "${rel}"`);
      return;
    }
    const stat = await lstat(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      failures.push(`${rel}:1: Structurizr DSL file must be a regular file, not a symlink`);
      return;
    }
    const canonical = await realpath(filePath);
    if (!inside(dslRoot, canonical)) {
      failures.push(`${rel}:1: Structurizr DSL file resolves outside architecture/structurizr/`);
      return;
    }
    if (visited.has(canonical)) return;
    visited.add(canonical);
    includedFiles.push(rel);

    const text = await readFile(filePath, "utf8");
    const { depth, minDepth } = countBraceDelta(text);
    if (depth !== 0 || minDepth < 0) {
      failures.push(`${rel}:1: Unbalanced braces in Structurizr DSL file`);
    }

    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNo = i + 1;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;

      const inc = /^!include\s+(.+)$/.exec(trimmed);
      if (inc) {
        const targetRel = inc[1].trim().replace(/^["']|["']$/g, "");
        const targetPath = resolve(dirname(filePath), targetRel);
        await walkDsl(targetPath, `${rel}:${lineNo}`);
        continue;
      }

      for (const mod of trimmed.matchAll(/\bsrc_module\s+"([^"]+)"/g)) {
        const name = mod[1];
        if (declaredModules.has(name)) {
          failures.push(
            `${rel}:${lineNo}: Duplicate src_module "${name}" (also declared in ${declaredModules.get(name)})`,
          );
        } else {
          declaredModules.set(name, `${rel}:${lineNo}`);
        }
      }

      const view =
        /^(?:systemContext|container|component|dynamic)\s+\S+\s+"([^"]+)"|^(?:deployment)\s+\S+\s+"[^"]+"\s+"([^"]+)"/.exec(
          trimmed,
        );
      if (view) {
        const key = view[1] ?? view[2];
        if (key) {
          if (viewKeys.has(key)) {
            failures.push(
              `${rel}:${lineNo}: Duplicate Structurizr view key "${key}" (also in ${viewKeys.get(key)})`,
            );
          } else {
            viewKeys.set(key, `${rel}:${lineNo}`);
          }
        }
      }
    }
  };

  await walkDsl(workspacePath, "architecture/structurizr/workspace.dsl");

  if (viewKeys.size === 0) {
    failures.push("architecture/structurizr/workspace.dsl:1: No Structurizr views declared");
  }

  // Verify 1:1 parity between src/<module> directories and C4 src_module declarations.
  const srcRoot = resolve(root, "src");
  if (await exists(srcRoot)) {
    const srcModules = (await readdir(srcRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const srcSet = new Set(srcModules);

    for (const mod of srcModules) {
      if (!declaredModules.has(mod)) {
        failures.push(
          `architecture/structurizr/workspace.dsl:1: Source module "src/${mod}" is missing a src_module "${mod}" entry in the C4 model`,
        );
      }
    }
    for (const [mod, where] of declaredModules) {
      if (!srcSet.has(mod)) {
        failures.push(`${where}: Modeled src_module "${mod}" does not exist under src/`);
      }
    }
  }

  // Verify C4 knowledge base pages exist when knowledge/ is present.
  if (await exists(resolve(root, "knowledge"))) {
    for (const docPath of REQUIRED_KB_C4_DOCS) {
      if (!(await exists(resolve(root, docPath)))) {
        failures.push(`${docPath}:1: Missing C4 knowledge base document`);
      }
    }
  }

  return failures;
}

function worktreeHash(root) {
  return createHash("sha256").update(root).digest("hex").slice(0, 12);
}

function structurizrImage() {
  return process.env.CODE60_STRUCTURIZR_IMAGE?.trim() || DEFAULT_STRUCTURIZR_IMAGE;
}

function ensureDocker() {
  const probe = spawnSync("docker", ["info"], { stdio: "ignore", timeout: 10_000 });
  if (probe.status !== 0) {
    throw new Error(
      "Docker daemon is not running or docker CLI is unavailable. Start Docker and retry.",
    );
  }
}

function parseFlag(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`Missing value for ${name}`);
  return value;
}

async function runValidate(directory = repository) {
  ensureDocker();
  const root = await realpath(directory);
  const dslRoot = resolve(root, "architecture/structurizr");
  const hash = worktreeHash(root);
  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--label",
      "code60.role=c4-validate",
      "--label",
      `code60.worktree=${hash}`,
      "-v",
      `${dslRoot}:/usr/local/structurizr:ro`,
      structurizrImage(),
      "validate",
      "-workspace",
      "workspace.dsl",
    ],
    { stdio: "inherit", timeout: 120_000 },
  );
  if (result.status !== 0) {
    throw new Error(`Structurizr DSL validation failed (exit ${result.status ?? 1}).`);
  }
}

async function runExport(args, directory = repository) {
  ensureDocker();
  const root = await realpath(directory);
  const format = parseFlag(args, "--format", "mermaid");
  if (!ALLOWED_EXPORT_FORMATS.has(format)) {
    throw new Error(
      `Unsupported export format "${format}". Allowed: ${[...ALLOWED_EXPORT_FORMATS].join(", ")}`,
    );
  }
  const outRel = parseFlag(args, "--out", "test-results/c4");
  const testResultsRoot = resolve(root, "test-results");
  const outPath = resolve(root, outRel);
  if (!inside(testResultsRoot, outPath)) {
    throw new Error(
      `Export output "${outRel}" must stay inside gitignored test-results/ (e.g., test-results/c4).`,
    );
  }
  await mkdir(outPath, { recursive: true });
  const dslRoot = resolve(root, "architecture/structurizr");
  const hash = worktreeHash(root);
  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--label",
      "code60.role=c4-export",
      "--label",
      `code60.worktree=${hash}`,
      "-v",
      `${dslRoot}:/usr/local/structurizr:ro`,
      "-v",
      `${outPath}:/export`,
      structurizrImage(),
      "export",
      "-workspace",
      "workspace.dsl",
      "-format",
      format,
      "-output",
      "/export",
    ],
    { stdio: "inherit", timeout: 120_000 },
  );
  if (result.status !== 0) {
    throw new Error(`Structurizr export failed (exit ${result.status ?? 1}).`);
  }
  console.log(`Exported Structurizr ${format} artifacts to ${relative(root, outPath)}/`);
}

async function runView(args, directory = repository) {
  ensureDocker();
  const root = await realpath(directory);
  const portRaw = parseFlag(args, "--port", "8080");
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`Invalid port "${portRaw}". Choose an integer port between 1024 and 65535.`);
  }
  const dslRoot = resolve(root, "architecture/structurizr");
  const hash = worktreeHash(root);
  const containerName = `code60-c4-${hash}-${port}`;
  console.log(`Starting Structurizr local viewer on http://127.0.0.1:${port} (Ctrl+C to stop)...`);
  const child = spawn(
    "docker",
    [
      "run",
      "--rm",
      "--name",
      containerName,
      "--label",
      "code60.role=c4-viewer",
      "--label",
      `code60.worktree=${hash}`,
      "-p",
      `127.0.0.1:${port}:8080`,
      "-v",
      `${dslRoot}:/usr/local/structurizr`,
      structurizrImage(),
      "local",
    ],
    { stdio: "inherit" },
  );

  const stop = () => {
    spawnSync("docker", ["stop", "-t", "5", containerName], { stdio: "ignore", timeout: 10_000 });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  await new Promise((resolveDone, rejectDone) => {
    child.once("error", rejectDone);
    child.once("exit", (code) => {
      if (code === 0 || code === 130 || code === 143 || code === null) resolveDone();
      else rejectDone(new Error(`Structurizr viewer exited with status ${code}`));
    });
  });
}

if (
  process.argv[1] &&
  (await realpath(resolve(process.argv[1])).catch(() => null)) === fileURLToPath(import.meta.url)
) {
  const [command = "check", ...args] = process.argv.slice(2);
  try {
    if (command === "check") {
      const failures = await checkC4Architecture();
      if (failures.length) {
        console.error(failures.join("\n"));
        process.exitCode = 1;
      } else {
        console.log("C4 architecture DSL, module parity, and KB docs passed.");
      }
    } else if (command === "validate") {
      await runValidate();
    } else if (command === "export") {
      await runExport(args);
    } else if (command === "view") {
      await runView(args);
    } else {
      console.error(
        "Usage: node scripts/c4.mjs <check|validate|view [--port 8080]|export [--format mermaid] [--out test-results/c4]>",
      );
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
