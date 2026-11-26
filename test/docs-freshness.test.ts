import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MEMORY_LIMITS } from "../src/application/memory-limits.js";
import { PROVIDERS } from "../src/application/provider-catalog.js";
import { DEFAULT_CONFIG } from "../src/core/index.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readDoc = (name: string) => readFileSync(resolve(ROOT, name), "utf8");
const PKG = JSON.parse(readDoc("package.json")) as { version: string };

const METADATA_RE =
  /^> \*\*Applies to:\*\* Code60 `v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)` · \*\*Last update:\*\* `(\d{4}-\d{2}-\d{2})`/m;

const BANNED_PATTERNS: readonly string[] = [
  "delve",
  "delves",
  "delved",
  "delving",
  "leverage",
  "leverages",
  "leveraged",
  "leveraging",
  "utilize",
  "utilizes",
  "utilized",
  "utilizing",
  "utilization",
  "utilise",
  "utilises",
  "utilised",
  "utilising",
  "utilisation",
  "foster",
  "fosters",
  "fostered",
  "fostering",
  "synergy",
  "synergies",
  "synergistic",
  "synergistically",
  "holistic",
  "holistically",
  "seamless",
  "seamlessly",
  "transformative",
  "transformatively",
  "game-changing",
  "game changing",
  "tapestry",
  "tapestries",
  "elevate",
  "elevates",
  "elevated",
  "elevating",
  "empower",
  "empowers",
  "empowered",
  "empowering",
  "empowerment",
  "unlock",
  "unlocks",
  "unlocked",
  "unlocking",
  "unleash",
  "unleashes",
  "unleashed",
  "unleashing",
  "revolutionize",
  "revolutionizes",
  "revolutionized",
  "revolutionizing",
  "revolutionise",
  "revolutionises",
  "revolutionised",
  "revolutionising",
  "groundbreaking",
  "ground-breaking",
  "ground breaking",
  "cutting-edge",
  "cutting edge",
  "world-class",
  "world class",
  "unparalleled",
  "unprecedented",
  "robust",
  "robustly",
  "robustness",
  "dynamic",
  "dynamically",
  "dynamism",
  "vibrant",
  "vibrantly",
  "vibrancy",
  "multifaceted",
  "multi-faceted",
  "multi faceted",
  "pivotal",
  "pivotally",
  "crucial",
  "crucially",
  "meticulous",
  "meticulously",
  "meticulousness",
  "bespoke",
  "optimize",
  "optimizes",
  "optimized",
  "optimizing",
  "optimization",
  "optimise",
  "optimises",
  "optimised",
  "optimising",
  "optimisation",
  "streamline",
  "streamlines",
  "streamlined",
  "streamlining",
  "supercharge",
  "supercharges",
  "supercharged",
  "supercharging",
  "amplify",
  "amplifies",
  "amplified",
  "amplifying",
  "amplification",
  "ecosystem",
  "ecosystems",
  "paradigm",
  "paradigms",
  "journey",
  "journeys",
  "journeyed",
  "journeying",
  "it's worth noting",
  "it is worth noting",
  "it's important to note",
  "it is important to note",
  "needless to say",
  "it goes without saying",
  "in today's fast-paced world",
  "in today's digital landscape",
  "in the ever-evolving landscape",
  "let's dive in",
  "let us dive in",
  "let's delve into",
  "let us delve into",
  "unlock the power of",
  "take it to the next level",
  "at the end of the day",
  "think outside the box",
  "move the needle",
  "hit the ground running",
  "low-hanging fruit",
  "low hanging fruit",
  "a game changer",
  "a game-changer",
  "a testament to",
  "a rich tapestry of",
  "the power of",
  "deep dive",
  "deep dives",
  "deep-dive",
  "deep-dives",
  "dive deep",
  "dives deep",
  "dived deep",
  "diving deep",
  "embark on a journey",
  "navigate the complexities",
  "without further ado",
  "rest assured",
  "i hope this finds you well",
  "great question",
  "absolutely",
  "bottom line",
  "bottom-line",
];

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u2010-\u2014\u2212]/g, "-");

const stripCode = (value: string) =>
  value
    .replace(/`[^`]+`/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_]/g, "");

const countWords = (value: string) => {
  const cleaned = stripCode(value)
    .replace(/(\d),(\d)/g, "$1$2")
    .replace(/[^\p{L}\p{N}'-]/gu, " ")
    .trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
};

const isValidIsoDate = (dateText: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
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
};

const sectionBody = (doc: string, heading: string) => {
  const marker = `\n${heading}\n`;
  const start = doc.indexOf(marker);
  if (start < 0) return "";
  const rest = doc.slice(start + marker.length);
  const level = heading.match(/^#+/)?.[0].length ?? 2;
  const next = rest.search(new RegExp(`\n#{1,${level}} `));
  return next < 0 ? rest : rest.slice(0, next);
};

describe("FAQ and Terminology freshness", () => {
  const faq = readDoc("FAQ.md");
  const terminology = readDoc("TERMINOLOGY.md");

  it("stamps both FAQ.md and TERMINOLOGY.md with the current package version and a valid date", () => {
    for (const [name, content] of [
      ["FAQ.md", faq],
      ["TERMINOLOGY.md", terminology],
    ] as const) {
      const match = METADATA_RE.exec(content);
      expect(match, `${name} must declare Applies to and Last update metadata`).not.toBeNull();
      expect(match?.[1], `${name} version must match package.json`).toBe(PKG.version);
      expect(isValidIsoDate(match?.[2] ?? ""), `${name} Last update must be a valid ISO date`).toBe(
        true,
      );
    }
  });

  it("keeps TERMINOLOGY.md entries in alphabetical order and synced with its Terms index", () => {
    const headings = terminology
      .split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3).trim());
    expect(headings[0]).toBe("Terms");
    const terms = headings.slice(1);
    const sorted = [...terms].sort((a, b) => a.localeCompare(b));
    expect(terms).toEqual(sorted);

    const indexSection = sectionBody(terminology, "## Terms");
    const indexed = [...indexSection.matchAll(/^- \[([^\]]+)\]\(#[^)]+\)$/gm)].map((m) => m[1]);
    expect(indexed).toEqual(terms);
  });

  it("keeps FAQ.md Contents aligned with Code60-level sections", () => {
    const preProvider = faq.split("\n---\n")[0] ?? faq;
    const sections = preProvider
      .split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3).trim());
    expect(sections[0]).toBe("Contents");
    const expected = sections.slice(1);
    const contentsBody = sectionBody(faq, "## Contents");
    const listed = [...contentsBody.matchAll(/^- \[([^\]]+)\]\(#[^)]+\)$/gm)].map((m) => m[1]);
    expect(listed).toEqual(expected);
  });

  it("keeps built-in Agent Providers synchronized with the provider catalog", () => {
    const providerSupport = sectionBody(faq, "## Provider Support");
    const agentProvider = sectionBody(terminology, "## Agent Provider");
    for (const provider of PROVIDERS) {
      expect(providerSupport).toContain(provider.name);
      expect(agentProvider).toContain(provider.name);
    }
  });

  it("keeps documented concurrency and context-handoff defaults aligned with runtime constants", () => {
    const concurrency = sectionBody(
      faq,
      "### Does Code60 limit the number of agents that I can run simultaneously?",
    );
    expect(concurrency).toContain(`**${DEFAULT_CONFIG.maxParallel}**`);

    const contextSection = sectionBody(faq, "## Context and History");
    expect(contextSection).toContain(`${MEMORY_LIMITS.rolloverPercent}%`);
    expect(contextSection).toContain(MEMORY_LIMITS.capacity.toLocaleString("en-US"));
  });

  it("uses a short heading and Code60-prefixed body name for Gateway", () => {
    const gateway = sectionBody(terminology, "## Gateway");
    expect(terminology).not.toContain("## Code60 Gateway");
    expect(gateway).toContain("Code60 Gateway");
  });

  it("enforces Refreshingly Simple English mechanical hygiene in FAQ.md and TERMINOLOGY.md", () => {
    const failures: string[] = [];
    for (const [name, content] of [
      ["FAQ.md", faq],
      ["TERMINOLOGY.md", terminology],
    ] as const) {
      content.split("\n").forEach((line, index) => {
        const trimmed = line.trim();
        if (/^---+$/.test(trimmed) || /^\|\s*---/.test(trimmed)) return;
        const prose = stripCode(line);
        if (prose.includes("\u2014")) failures.push(`${name}:${index + 1}: em dash in prose`);
        if (prose.includes("--")) failures.push(`${name}:${index + 1}: double hyphen in prose`);
        if (prose.includes(";")) failures.push(`${name}:${index + 1}: semicolon in prose`);
      });

      const normalized = normalize(stripCode(content));
      for (const term of BANNED_PATTERNS) {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`(?<![a-z0-9])${escaped}(?:'s)?(?![a-z0-9])`, "i");
        if (re.test(normalized)) failures.push(`${name}: banned expression "${term}"`);
      }

      let currentHeading = "(intro)";
      let previousLevel = 0;
      const segmentWords = new Map<string, number>();

      for (const block of content.split(/\n\s*\n/)) {
        const trimmed = block.trim();
        if (!trimmed || /^---+$/.test(trimmed) || trimmed.startsWith("> ")) continue;
        const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
        if (headingMatch) {
          const level = headingMatch[1]?.length ?? 1;
          if (previousLevel && level > previousLevel + 1) {
            failures.push(`${name}: skipped heading level at ${trimmed}`);
          }
          previousLevel = level;
          currentHeading = trimmed;
          segmentWords.set(currentHeading, 0);
          continue;
        }
        const lines = trimmed.split("\n");
        let paragraphs: string[];
        if (lines.every((l) => /^\s*\|/.test(l))) {
          paragraphs = [];
          for (const row of lines) {
            if (/^\|\s*---/.test(row.trim())) continue;
            for (const cell of row.replace(/^\||\|$/g, "").split("|")) paragraphs.push(cell.trim());
          }
        } else if (lines.every((l) => /^\s*-\s+/.test(l))) {
          paragraphs = lines.map((l) => l.replace(/^\s*-\s+/, ""));
        } else {
          paragraphs = [trimmed];
        }
        for (const paragraph of paragraphs) {
          const text = stripCode(paragraph).replace(/\bNode\.js\b/g, "Nodejs");
          const sentences = text
            .split(/(?<=[.!?])\s+/)
            .map((s) => s.trim())
            .filter(Boolean);
          if (sentences.length > 3) {
            failures.push(`${name}: paragraph exceeds 3 sentences in ${currentHeading}`);
          }
          for (const sentence of sentences) {
            const words = countWords(sentence);
            if (words > 25) {
              failures.push(
                `${name}: sentence exceeds 25 words (${words}) in ${currentHeading}: ${sentence}`,
              );
            }
          }
          segmentWords.set(
            currentHeading,
            (segmentWords.get(currentHeading) ?? 0) + countWords(paragraph),
          );
        }
      }

      for (const [heading, words] of segmentWords) {
        if (words > 250) {
          failures.push(`${name}: section exceeds 250 prose words (${words}) in ${heading}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
