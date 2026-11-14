import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const repository = fileURLToPath(new URL("..", import.meta.url));
const inside = (root, path) => {
  const name = relative(root, path);
  return name !== ".." && !name.startsWith(`..${sep}`) && !isAbsolute(name);
};
const withoutFences = (text) =>
  text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, (block) =>
    block.replace(/[^\n]/g, " "),
  );
const referenceKey = (text) => text.trim().replace(/\s+/g, " ").toLowerCase();

/** Extract destinations without treating a title or a balanced path as executable text. */
function markdownLinks(markdown) {
  const links = [];
  for (const match of markdown.matchAll(/\]\(/g)) {
    let cursor = match.index + 2;
    while (/\s/.test(markdown[cursor] ?? "") && cursor < markdown.length) cursor++;
    const start = cursor;
    let link;
    if (markdown[cursor] === "<") {
      const end = markdown.indexOf(">", cursor + 1);
      if (end < 0) {
        links.push({ index: match.index, error: "Unclosed Markdown link destination" });
        continue;
      }
      link = markdown.slice(cursor + 1, end);
      cursor = end + 1;
    } else {
      let depth = 0;
      while (cursor < markdown.length) {
        const character = markdown[cursor];
        if (character === "\\") cursor++;
        else if (character === "(") depth++;
        else if (character === ")") {
          if (!depth) break;
          depth--;
        } else if (/\s/.test(character)) break;
        cursor++;
      }
      link = markdown.slice(start, cursor);
    }
    if (!/^\s*(?:(?:"[^"]*"|'[^']*'|\([^)]*\))\s*)?\)/.test(markdown.slice(cursor))) {
      links.push({ index: match.index, error: "Unsupported or unclosed Markdown link" });
      continue;
    }
    links.push({ index: match.index, link });
  }
  for (const match of markdown.matchAll(/^ {0,3}\[[^\]\n]+\]:\s*(<[^>\n]+>|[^\s\n]+)/gm))
    links.push({ index: match.index, link: match[1].replace(/^<|>$/g, "") });
  return links;
}

function anchors(text) {
  const counts = new Map();
  const result = new Set(
    [
      ...withoutFences(text).matchAll(
        /^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$|^(.+)\n {0,3}(?:=+|-+)[ \t]*$/gm,
      ),
    ].map((match) => {
      const slug = (match[1] ?? match[2])
        .toLowerCase()
        .replace(/<[^>]*>/g, "")
        .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "")
        .replace(/\s/g, "-");
      const count = counts.get(slug) ?? 0;
      counts.set(slug, count + 1);
      return count ? `${slug}-${count}` : slug;
    }),
  );
  for (const match of withoutFences(text).matchAll(/<a\s+[^>]*(?:id|name)=["']([^"']+)["'][^>]*>/g))
    result.add(match[1]);
  return result;
}

/** Checks references, not prose semantics. Never executes Markdown or follows remote links. */
export async function checkInstructions(directory = repository) {
  const root = await realpath(directory);
  const failures = [];
  const documents = new Set(["AGENTS.md"]);
  const cache = new Map();
  const fail = (file, line, message) => failures.push(`${file}:${line}: ${message}`);
  const checked = async (file) => {
    const path = resolve(root, file);
    if (!inside(root, path) || !inside(root, await realpath(path)))
      throw new Error("Reference leaves the repository");
    return path;
  };
  const local = async (file) => {
    const path = await checked(file);
    if (!(await stat(path)).isFile()) throw new Error("Expected a regular file");
    if (!cache.has(path)) cache.set(path, await readFile(path, "utf8"));
    return cache.get(path);
  };
  const manifest = JSON.parse(await local("package.json"));
  for (const entry of await readdir(root, { withFileTypes: true }))
    if (entry.isFile() && entry.name.endsWith(".md")) documents.add(entry.name);
  for (const module of await readdir(resolve(root, "src"), { withFileTypes: true })) {
    if (module.isDirectory()) documents.add(`src/${module.name}/AGENTS.md`);
  }
  const skills = [];
  const collect = async (folder, optional = false) => {
    let entries;
    try {
      entries = await readdir(resolve(root, folder), { withFileTypes: true });
    } catch (error) {
      if (optional && error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = `${folder}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        fail(file, 1, "Managed documentation must not be a symbolic link");
      } else if (entry.isDirectory()) await collect(file);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        documents.add(file);
        if (entry.name === "SKILL.md") skills.push(file);
      }
    }
  };
  await collect(".factory/skills", true);
  await collect("docs", true);
  const names = new Set();
  for (const file of [...documents].sort()) {
    let text;
    try {
      text = await local(file);
    } catch {
      fail(file, 1, "Missing, unreadable, or unsafe instruction/document file");
      continue;
    }
    if ((file.endsWith("AGENTS.md") || file.endsWith("SKILL.md")) && !text.trim())
      fail(file, 1, "Instruction file must not be empty");
    if (skills.includes(file)) {
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/.exec(text);
      try {
        const metadata = frontmatter && parse(frontmatter[1]);
        if (
          !metadata ||
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.name) ||
          metadata.name !== basename(resolve(root, file, "..")) ||
          typeof metadata.description !== "string" ||
          !metadata.description.trim() ||
          !frontmatter[2].trim() ||
          names.has(metadata.name)
        )
          throw new Error("Invalid skill");
        names.add(metadata.name);
      } catch {
        fail(
          file,
          1,
          "Skill needs unique directory-matching name, description, and prompt content",
        );
      }
    }
    const lineOf = (index) => text.slice(0, index).split("\n").length;
    for (const match of text.matchAll(/\bnpm\s+run(?:-script)?\s+([\w:-]+)/g)) {
      if (typeof manifest.scripts?.[match[1]] !== "string")
        fail(file, lineOf(match.index), `Unknown npm script: ${match[1]}`);
    }
    const markdown = withoutFences(text).replace(/(`+)[\s\S]*?\1(?!`)/g, (code) =>
      code.replace(/[^\n]/g, " "),
    );
    const definitions = new Set(
      [...markdown.matchAll(/^ {0,3}\[([^\]\n]+)\]:/gm)].map((match) => referenceKey(match[1])),
    );
    for (const match of markdown.matchAll(/!?\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
      if (!definitions.has(referenceKey(match[2] || match[1])))
        fail(file, lineOf(match.index), `Undefined Markdown reference: ${match[2] || match[1]}`);
    }
    for (const match of markdownLinks(markdown)) {
      if (match.error) {
        fail(file, lineOf(match.index), match.error);
        continue;
      }
      const link = match.link.replace(/\\([^\p{L}\p{N}\s])/gu, "$1");
      if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(link)) continue;
      try {
        const hash = link.indexOf("#");
        const target = (hash < 0 ? link : link.slice(0, hash)).split("?")[0];
        const fragment = hash < 0 ? "" : link.slice(hash + 1);
        const path = target
          ? resolve(root, file, "..", decodeURIComponent(target))
          : resolve(root, file);
        await checked(path);
        if (fragment && !anchors(await local(path)).has(decodeURIComponent(fragment)))
          throw new Error("Missing anchor");
      } catch {
        fail(file, lineOf(match.index), `Broken or unsafe local link: ${link}`);
      }
    }
  }
  return failures;
}

if (
  process.argv[1] &&
  (await realpath(resolve(process.argv[1])).catch(() => null)) === fileURLToPath(import.meta.url)
) {
  try {
    const failures = await checkInstructions();
    if (failures.length) {
      console.error(failures.join("\n"));
      process.exitCode = 1;
    } else console.log("Instruction, skill, and runbook references passed.");
  } catch {
    console.error("Instruction validation could not complete. Check repository files and npm ci.");
    process.exitCode = 1;
  }
}
