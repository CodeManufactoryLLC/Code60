import { constants, open, readdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Markdown from "react-markdown";
import { parse } from "yaml";

const repository = fileURLToPath(new URL("..", import.meta.url));
const inside = (root, path) => {
  const name = relative(root, path);
  return name !== ".." && !name.startsWith(`..${sep}`) && !isAbsolute(name);
};
const referenceKey = (text) => text.trim().replace(/\s+/g, " ").toLowerCase();

function markdownDocument(text) {
  let document;
  // Reuse the app's existing CommonMark parser, without rendering or fetching URLs.
  Markdown({
    children: text,
    remarkPlugins: [
      () => (tree) => {
        document = tree;
      },
    ],
    skipHtml: true,
  });
  const prose = text.split("");
  const headings = [];
  const explicit = new Set();
  const inlineText = (node) => {
    if (node.type === "text" || node.type === "inlineCode") return node.value;
    if (node.type === "image" || node.type === "imageReference") return node.alt;
    return (node.children ?? []).map(inlineText).join("");
  };
  const visit = (node) => {
    if (node.type === "heading") headings.push(inlineText(node));
    if (node.type === "code" || node.type === "inlineCode") {
      for (let index = node.position.start.offset; index < node.position.end.offset; index++)
        if (prose[index] !== "\n") prose[index] = " ";
    }
    if (node.type === "html") {
      for (const match of node.value.matchAll(/<a\s+[^>]*(?:id|name)=["']([^"']+)["'][^>]*>/g))
        explicit.add(match[1]);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(document);
  const generated = new Set();
  for (const heading of headings) {
    const base = heading
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "")
      .replace(/\s/g, "-");
    let slug = base;
    let suffix = 0;
    while (generated.has(slug)) slug = `${base}-${++suffix}`;
    generated.add(slug);
  }
  return { prose: prose.join(""), anchors: new Set([...generated, ...explicit]) };
}

function npmScripts(text) {
  const valueOptions = new Set([
    "-w",
    "--workspace",
    "--prefix",
    "--script-shell",
    "--loglevel",
    "--userconfig",
    "--globalconfig",
    "--cache",
    "--registry",
  ]);
  const scripts = [];
  for (const match of text.matchAll(/\bnpm[ \t]+run(?:-script)?(?=[ \t])/g)) {
    const rest = text.slice(match.index + match[0].length).split(/[\r\n`;&|]/, 1)[0];
    const tokens = [...rest.matchAll(/"([^"]*)"|'([^']*)'|([^\s"']+)/g)].map(
      (token) => token[1] ?? token[2] ?? token[3],
    );
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (token === "--") {
        if (tokens[index + 1]) scripts.push({ name: tokens[index + 1], index: match.index });
        break;
      }
      if (valueOptions.has(token)) index++;
      else if (!token.startsWith("-")) {
        if (!/[$\\]/.test(token)) scripts.push({ name: token, index: match.index });
        break;
      } else if (/^(?:true|false)$/.test(tokens[index + 1] ?? "")) index++;
    }
  }
  return scripts;
}

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

/** Checks references, not prose semantics. Never executes Markdown or follows remote links. */
export async function checkInstructions(directory = repository) {
  const root = await realpath(directory);
  const failures = [];
  const documents = new Set(["AGENTS.md"]);
  const cache = new Map();
  const parsed = new Map();
  const markdown = (text) => {
    if (!parsed.has(text)) parsed.set(text, markdownDocument(text));
    return parsed.get(text);
  };
  const fail = (file, line, message) => failures.push(`${file}:${line}: ${message}`);
  const checked = async (file) => {
    const path = resolve(root, file);
    if (!inside(root, path) || !inside(root, await realpath(path)))
      throw new Error("Reference leaves the repository");
    return path;
  };
  const local = async (file) => {
    const path = await checked(file);
    const handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    try {
      if (!(await handle.stat()).isFile()) throw new Error("Expected a regular file");
      if (!cache.has(path)) cache.set(path, await handle.readFile("utf8"));
      return cache.get(path);
    } finally {
      await handle.close();
    }
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
  await collect("knowledge", true);
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
    for (const script of npmScripts(text)) {
      if (typeof manifest.scripts?.[script.name] !== "string")
        fail(file, lineOf(script.index), `Unknown npm script: ${script.name}`);
    }
    const prose = markdown(text).prose;
    const definitions = new Set(
      [...prose.matchAll(/^ {0,3}\[([^\]\n]+)\]:/gm)].map((match) => referenceKey(match[1])),
    );
    for (const match of prose.matchAll(/!?\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
      if (!definitions.has(referenceKey(match[2] || match[1])))
        fail(file, lineOf(match.index), `Undefined Markdown reference: ${match[2] || match[1]}`);
    }
    for (const match of markdownLinks(prose)) {
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
        if (fragment && !markdown(await local(path)).anchors.has(decodeURIComponent(fragment)))
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
