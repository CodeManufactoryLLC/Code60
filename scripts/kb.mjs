import { access, lstat, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const repository = fileURLToPath(new URL("..", import.meta.url));
const BEGIN_MARKER = "<!-- BEGIN:KB_INDEX -->";
const END_MARKER = "<!-- END:KB_INDEX -->";

export const DOMAINS = [
  {
    id: "governance",
    code: "GOV",
    path: "knowledge/governance",
    description: "Normative policies, RFC 2119 standards, contributor/release/branch rules",
  },
  {
    id: "architecture",
    code: "ARCH",
    path: "knowledge/architecture",
    description: "System architecture, module boundaries, and architectural decision records",
  },
  {
    id: "subsystems",
    code: "SUB",
    path: "knowledge/subsystems",
    description: "Canonical specifications per runtime subsystem",
  },
  {
    id: "operations",
    code: "OPS",
    path: "knowledge/operations",
    description: "Operational runbooks, installation, distribution, updates, and recovery",
  },
  {
    id: "reference",
    code: "REF",
    path: "knowledge/reference",
    description: "Machine-synced or generated technical references",
  },
];

const DOMAIN_BY_ID = new Map(DOMAINS.map((domain) => [domain.id, domain]));
const ALLOWED_KINDS = new Set(["normative", "adr", "subsystem", "runbook", "reference"]);
const ALLOWED_STATUSES = new Set(["active", "draft", "deprecated", "superseded"]);
const ALLOWED_FRONTMATTER_KEYS = new Set([
  "id",
  "title",
  "domain",
  "kind",
  "status",
  "summary",
  "updated",
  "rule_prefix",
  "code_refs",
  "related",
  "tags",
]);
const RFC2119_RE =
  /\b(MUST NOT|MUST|REQUIRED|SHALL NOT|SHALL|SHOULD NOT|SHOULD|RECOMMENDED|MAY|OPTIONAL)\b/;
const LOWERCASE_RFC2119_RE = /\b(must|shall|should|may|required|recommended|optional)\b/;
const DOC_ID_RE = /^KB-(GOV|ARCH|SUB|OPS|REF)-[0-9]{3}$/;
const RULE_PREFIX_RE = /^[A-Z][A-Z0-9]{1,7}$/;
const TAG_RE = /^[a-z0-9-]+$/;

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

function isValidIsoDate(text) {
  if (typeof text !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

async function collectMarkdown(root, folder, failures) {
  const files = [];
  const walk = async (relDir) => {
    let entries;
    try {
      entries = await readdir(resolve(root, relDir), { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relPath = `${relDir}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        failures.push(`${relPath}:1: Knowledge base file must not be a symbolic link`);
      } else if (entry.isDirectory()) {
        await walk(relPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(relPath);
      }
    }
  };
  await walk(folder);
  return files;
}

function validateStipulations(relPath, body, prefix, failures) {
  const lines = body.split(/\r?\n/);
  const seen = new Set();
  const counters = new Map();
  const ruleIds = [];
  let section = null;
  let inFence = false;
  const stipRe = new RegExp(`^- \`(${prefix}-(\\d+\\.\\d+)\\.(\\d+))\` (.+)$`);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h3 = /^### (\d+\.\d+)\s+/.exec(line);
    if (h3) {
      section = h3[1];
      counters.set(section, 0);
      continue;
    }
    const match = stipRe.exec(line);
    if (match) {
      const [, id, sec, numText, text] = match;
      const num = Number(numText);
      if (seen.has(id)) failures.push(`${relPath}:${lineNo}: Duplicate stipulation ID ${id}`);
      seen.add(id);
      ruleIds.push(id);
      if (sec !== section) {
        failures.push(
          `${relPath}:${lineNo}: Stipulation ${id} does not match enclosing subsection ${section ?? "(none)"}`,
        );
      } else {
        const expected = (counters.get(section) ?? 0) + 1;
        if (num !== expected) {
          failures.push(
            `${relPath}:${lineNo}: Stipulation ${id} is out of sequence (expected ${prefix}-${section}.${expected})`,
          );
        }
        counters.set(section, num);
      }
      if (!RFC2119_RE.test(text)) {
        failures.push(`${relPath}:${lineNo}: Stipulation ${id} lacks an RFC 2119 keyword`);
      }
      if (lines[i + 1] && /^ {2}\S/.test(lines[i + 1])) {
        failures.push(`${relPath}:${lineNo}: Stipulation ${id} must stay on a single line`);
      }
    }
    if (!/^> /.test(line) && !/^#/.test(line)) {
      const stripped = line.replace(/`[^`]+`/g, "");
      if (LOWERCASE_RFC2119_RE.test(stripped)) {
        failures.push(
          `${relPath}:${lineNo}: Lowercase RFC 2119 keyword in normative document prose`,
        );
      }
    }
  }
  return ruleIds;
}

async function scanKnowledgeBase(directory = repository) {
  const root = await realpath(directory);
  const failures = [];
  const documents = [];
  const byId = new Map();

  for (const domain of DOMAINS) {
    const files = await collectMarkdown(root, domain.path, failures);
    for (const relPath of files) {
      const fullPath = resolve(root, relPath);
      if (!inside(root, fullPath) || !inside(root, await realpath(fullPath))) {
        failures.push(`${relPath}:1: Path leaves repository`);
        continue;
      }
      const stat = await lstat(fullPath);
      if (!stat.isFile()) {
        failures.push(`${relPath}:1: Expected a regular file`);
        continue;
      }
      const raw = await readFile(fullPath, "utf8");
      const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
      if (!fmMatch) {
        failures.push(`${relPath}:1: Missing YAML frontmatter`);
        continue;
      }
      let meta;
      try {
        meta = parse(fmMatch[1]);
      } catch {
        failures.push(`${relPath}:1: Invalid YAML frontmatter`);
        continue;
      }
      if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
        failures.push(`${relPath}:1: Frontmatter must be a YAML mapping`);
        continue;
      }
      for (const key of Object.keys(meta)) {
        if (!ALLOWED_FRONTMATTER_KEYS.has(key)) {
          failures.push(`${relPath}:1: Unknown frontmatter key "${key}"`);
        }
      }
      const id = meta.id;
      const idMatch = typeof id === "string" ? DOC_ID_RE.exec(id) : null;
      if (!idMatch) {
        failures.push(`${relPath}:1: Invalid or missing id (expected KB-<DOMAIN>-<NNN>)`);
      } else if (idMatch[1] !== domain.code) {
        failures.push(
          `${relPath}:1: Document id "${id}" does not match folder domain code "${domain.code}"`,
        );
      } else if (byId.has(id)) {
        failures.push(`${relPath}:1: Duplicate document id "${id}" (also in ${byId.get(id)})`);
      } else {
        byId.set(id, relPath);
      }
      if (typeof meta.title !== "string" || !meta.title.trim()) {
        failures.push(`${relPath}:1: Frontmatter title must be a non-empty string`);
      }
      if (meta.domain !== domain.id) {
        failures.push(
          `${relPath}:1: Frontmatter domain "${String(meta.domain)}" must match folder "${domain.id}"`,
        );
      }
      if (typeof meta.kind !== "string" || !ALLOWED_KINDS.has(meta.kind)) {
        failures.push(`${relPath}:1: Invalid frontmatter kind "${String(meta.kind)}"`);
      }
      if (typeof meta.status !== "string" || !ALLOWED_STATUSES.has(meta.status)) {
        failures.push(`${relPath}:1: Invalid frontmatter status "${String(meta.status)}"`);
      }
      if (
        typeof meta.summary !== "string" ||
        !meta.summary.trim() ||
        meta.summary.length > 200 ||
        /[\r\n|]/.test(meta.summary)
      ) {
        failures.push(
          `${relPath}:1: Frontmatter summary must be a single line (1–200 chars, no "|" characters)`,
        );
      }
      const updated =
        meta.updated instanceof Date ? meta.updated.toISOString().slice(0, 10) : meta.updated;
      if (!isValidIsoDate(updated)) {
        failures.push(`${relPath}:1: Frontmatter updated must be a valid YYYY-MM-DD date`);
      }
      let ruleIds;
      if (meta.rule_prefix !== undefined) {
        if (typeof meta.rule_prefix !== "string" || !RULE_PREFIX_RE.test(meta.rule_prefix)) {
          failures.push(`${relPath}:1: Invalid rule_prefix "${String(meta.rule_prefix)}"`);
        } else {
          ruleIds = validateStipulations(relPath, fmMatch[2], meta.rule_prefix, failures);
        }
      }
      if (meta.code_refs !== undefined) {
        if (
          !Array.isArray(meta.code_refs) ||
          meta.code_refs.some((item) => typeof item !== "string" || !item.trim())
        ) {
          failures.push(`${relPath}:1: Frontmatter code_refs must be an array of paths`);
        } else {
          for (const refPath of meta.code_refs) {
            const resolved = resolve(root, refPath);
            if (!inside(root, resolved) || !(await exists(resolved))) {
              failures.push(`${relPath}:1: Missing or unsafe code_refs path "${refPath}"`);
            }
          }
        }
      }
      if (meta.related !== undefined) {
        if (
          !Array.isArray(meta.related) ||
          meta.related.some((item) => typeof item !== "string" || !DOC_ID_RE.test(item))
        ) {
          failures.push(`${relPath}:1: Frontmatter related must be an array of KB document IDs`);
        }
      }
      if (meta.tags !== undefined) {
        if (
          !Array.isArray(meta.tags) ||
          meta.tags.some((item) => typeof item !== "string" || !TAG_RE.test(item))
        ) {
          failures.push(`${relPath}:1: Frontmatter tags must be lowercase kebab-case strings`);
        }
      }

      const entry = {
        id: String(meta.id ?? ""),
        title: String(meta.title ?? "").trim(),
        domain: String(meta.domain ?? ""),
        kind: String(meta.kind ?? ""),
        status: String(meta.status ?? ""),
        summary: String(meta.summary ?? "").trim(),
        updated: String(updated ?? ""),
        path: relPath,
      };
      if (meta.rule_prefix) entry.rule_prefix = meta.rule_prefix;
      if (Array.isArray(meta.code_refs) && meta.code_refs.length) entry.code_refs = meta.code_refs;
      if (Array.isArray(meta.related) && meta.related.length) entry.related = meta.related;
      if (Array.isArray(meta.tags) && meta.tags.length) entry.tags = meta.tags;
      if (ruleIds?.length) entry.ruleIds = ruleIds;
      documents.push(entry);
    }
  }

  for (const doc of documents) {
    for (const relId of doc.related ?? []) {
      if (!byId.has(relId)) {
        failures.push(`${doc.path}:1: Frontmatter related ID "${relId}" does not exist`);
      }
    }
  }

  const domainOrder = new Map(DOMAINS.map((domain, index) => [domain.id, index]));
  documents.sort(
    (a, b) =>
      (domainOrder.get(a.domain) ?? 99) - (domainOrder.get(b.domain) ?? 99) ||
      a.id.localeCompare(b.id) ||
      a.path.localeCompare(b.path),
  );

  // Guard canonical capabilities placement whenever the contracts catalog is present.
  if (await exists(resolve(root, "src/contracts/knowledge.ts"))) {
    if (await exists(resolve(root, "docs/capabilities.md"))) {
      failures.push(
        "docs/capabilities.md:1: Legacy capabilities path must not exist; keep it at knowledge/reference/capabilities.md",
      );
    }
    const capDoc = documents.find((doc) => doc.path === "knowledge/reference/capabilities.md");
    if (!capDoc) {
      failures.push(
        "knowledge/reference/capabilities.md:1: Missing generated capability reference (run npm run generate:capabilities)",
      );
    } else if (capDoc.id !== "KB-REF-001") {
      failures.push(
        `knowledge/reference/capabilities.md:1: Capability reference must keep stable ID KB-REF-001 (got ${capDoc.id})`,
      );
    }
  }

  return { root, documents, failures };
}

function renderIndexMarkdown(existing, documents) {
  const start = existing.indexOf(BEGIN_MARKER);
  const end = existing.indexOf(END_MARKER);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`knowledge/INDEX.md must contain ${BEGIN_MARKER} and ${END_MARKER} markers`);
  }
  const block = documents.length
    ? [
        "| ID | Title | Domain | Kind | Status | Updated | Summary |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        ...documents.map((doc) => {
          const rel = doc.path.replace(/^knowledge\//, "");
          return `| \`${doc.id}\` | [${doc.title}](${rel}) | \`${doc.domain}\` | \`${doc.kind}\` | \`${doc.status}\` | \`${doc.updated}\` | ${doc.summary} |`;
        }),
      ].join("\n")
    : "_No domain documents indexed yet. Add documents under `governance/`, `architecture/`, `subsystems/`, `operations/`, or `reference/` using [templates/](templates/)._";

  return `${existing.slice(0, start + BEGIN_MARKER.length)}\n${block}\n${existing.slice(end)}`;
}

function renderIndexJson(documents) {
  const latestUpdated = documents.reduce(
    (latest, doc) => (doc.updated && (!latest || doc.updated > latest) ? doc.updated : latest),
    null,
  );
  const payload = {
    $schema: "./schema.json",
    schemaVersion: 1,
    generatedAt: latestUpdated,
    domains: DOMAINS.map((domain) => ({ ...domain })),
    documents,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export async function indexKnowledgeBase(directory = repository) {
  const { root, documents, failures } = await scanKnowledgeBase(directory);
  if (failures.length) {
    const error = new Error(failures.join("\n"));
    error.failures = failures;
    throw error;
  }
  const indexMdPath = resolve(root, "knowledge/INDEX.md");
  const indexJsonPath = resolve(root, "knowledge/index.json");
  const existingMd = await readFile(indexMdPath, "utf8");
  const nextMd = renderIndexMarkdown(existingMd, documents);
  const nextJson = renderIndexJson(documents);
  await writeFile(indexMdPath, nextMd, "utf8");
  await writeFile(indexJsonPath, nextJson, "utf8");
  return { count: documents.length, documents };
}

export async function checkKnowledgeBase(directory = repository) {
  const root = await realpath(directory);
  if (!(await exists(resolve(root, "knowledge")))) return [];
  const { documents, failures } = await scanKnowledgeBase(root);

  const indexMdPath = resolve(root, "knowledge/INDEX.md");
  const indexJsonPath = resolve(root, "knowledge/index.json");

  if (!(await exists(indexMdPath))) {
    failures.push("knowledge/INDEX.md:1: Missing knowledge base index");
  } else {
    try {
      const actualMd = await readFile(indexMdPath, "utf8");
      const expectedMd = renderIndexMarkdown(actualMd, documents);
      if (actualMd !== expectedMd) {
        failures.push(
          "knowledge/INDEX.md:1: Knowledge base index is out of date (run npm run kb:index)",
        );
      }
    } catch (error) {
      failures.push(`knowledge/INDEX.md:1: ${error.message}`);
    }
  }

  if (!(await exists(indexJsonPath))) {
    failures.push("knowledge/index.json:1: Missing machine-readable knowledge index");
  } else {
    const actualJson = await readFile(indexJsonPath, "utf8");
    const expectedJson = renderIndexJson(documents);
    if (actualJson !== expectedJson) {
      failures.push(
        "knowledge/index.json:1: Machine-readable knowledge index is out of date (run npm run kb:index)",
      );
    }
  }

  if (!(await exists(resolve(root, "knowledge/schema.json")))) {
    failures.push("knowledge/schema.json:1: Missing knowledge base schema");
  }

  // Ensure every domain key in DOMAIN_BY_ID is reachable
  for (const domain of DOMAIN_BY_ID.values()) {
    if (!(await exists(resolve(root, domain.path)))) {
      failures.push(`${domain.path}:1: Missing knowledge domain directory`);
    }
  }

  return failures;
}

export async function findKnowledge(query, directory = repository) {
  const root = await realpath(directory);
  const raw = await readFile(resolve(root, "knowledge/index.json"), "utf8");
  const data = JSON.parse(raw);
  const needle = query.trim().toLowerCase();
  if (!needle) return data.documents ?? [];
  return (data.documents ?? []).filter((doc) => {
    const fields = [
      doc.id,
      doc.title,
      doc.domain,
      doc.kind,
      doc.status,
      doc.summary,
      doc.path,
      ...(doc.code_refs ?? []),
      ...(doc.tags ?? []),
      ...(doc.ruleIds ?? []),
    ];
    return fields.some((value) => String(value).toLowerCase().includes(needle));
  });
}

if (
  process.argv[1] &&
  (await realpath(resolve(process.argv[1])).catch(() => null)) === fileURLToPath(import.meta.url)
) {
  const [command = "check", ...args] = process.argv.slice(2);
  try {
    if (command === "index") {
      const result = await indexKnowledgeBase();
      console.log(`Indexed ${result.count} knowledge base document(s).`);
    } else if (command === "check") {
      const failures = await checkKnowledgeBase();
      if (failures.length) {
        console.error(failures.join("\n"));
        process.exitCode = 1;
      } else {
        console.log("Knowledge base validation and index sync passed.");
      }
    } else if (command === "find") {
      const matches = await findKnowledge(args.join(" "));
      if (!matches.length) {
        console.log("No matching knowledge base documents.");
      } else {
        for (const doc of matches) {
          console.log(`${doc.id}  [${doc.domain}/${doc.status}]  ${doc.path} — ${doc.summary}`);
        }
      }
    } else {
      console.error("Usage: node scripts/kb.mjs <index|check|find [query]>");
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
