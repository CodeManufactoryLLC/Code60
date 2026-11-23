import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, realpath, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ProjectSearchQuery,
  parseProjectSearchOpen,
  parseProjectSearchPage,
  parseProjectSearchQuery,
} from "../bridge/index.js";
import { ProjectSearch } from "./project-search.js";
import type { SearchEvidenceReader } from "./project-search-reader.js";
import { sqliteAvailable } from "./projects.js";

let root: string;
let service: ProjectSearch;
const request = (extra: Partial<ProjectSearchQuery> = {}): ProjectSearchQuery => ({
  requestId: randomUUID(),
  databaseEpoch: 1,
  query: "needle",
  kind: "all",
  sort: "relevance",
  ...extra,
});
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "c60-search-test-")));
  service = new ProjectSearch(root);
});
afterEach(async () => {
  await service.cancel();
  await rm(root, { recursive: true, force: true });
});
async function project(name: string) {
  const path = join(root, name);
  await mkdir(path, { recursive: true });
  return { path, openedAt: "2026-01-01" };
}
const reader: SearchEvidenceReader = async (_project, _query, _files, _signal, add) => {
  add({
    id: "same-run",
    kind: "message",
    title: "Message / fake / run",
    text: "needle in this project",
    runId: "same-run",
    eventIndex: 0,
    at: "2026-01-01",
  });
  add({
    id: "file:README.md",
    kind: "file",
    title: "README.md",
    path: "README.md",
    text: "needle file",
    at: "",
  });
};

describe.skipIf(!sqliteAvailable())("database-wide project search", () => {
  it("includes >200 projects, qualifies duplicate IDs/names and pages an immutable result set", async () => {
    const projects = await Promise.all(Array.from({ length: 205 }, (_, i) => project(`${i}/same`)));
    const input = request({ kind: "message" });
    const page = await service.search(input, projects, reader, () => true);
    expect(page.total).toBe(205);
    expect(page.results).toHaveLength(100);
    expect(new Set(page.results.map((r) => r.id)).size).toBe(100);
    expect(page.results.every((r) => r.project.name === r.project.path)).toBe(true);
    const second = service.page(input, page.nextCursor ?? undefined);
    const last = service.page(input, second.nextCursor ?? undefined);
    expect(last.results).toHaveLength(5);
    expect(last.nextCursor).toBeNull();
    const all = [...page.results, ...second.results, ...last.results];
    expect(new Set(all.map((r) => r.project.path)).size).toBe(205);
    expect(new Set(all.map((r) => r.id)).size).toBe(205);
    expect(service.page(input, page.nextCursor ?? undefined)).toEqual(second);
    expect(
      (await readdir(root)).filter((n) => n.startsWith("code60-project-search-")),
    ).toHaveLength(1);
    const temp = (await readdir(root)).find((n) => n.startsWith("code60-project-search-"));
    expect((await lstat(join(root, temp ?? "", "results.sqlite"))).mode & 0o777).toBe(0o600);
    await service.cancel(input);
    expect((await readdir(root)).filter((n) => n.startsWith("code60-project-search-"))).toEqual([]);
  });

  it("ranks globally, supports newest/type filters, limits evidence and returns captured source ownership", async () => {
    const a = await project("a");
    const b = await project("b");
    const input = request({ query: "needle", kind: "message" });
    const read: SearchEvidenceReader = async (path, _q, _f, _s, add) => {
      for (let i = 0; i < 30; i++)
        add({
          id: `run-${i}:0`,
          runId: `run-${i}`,
          eventIndex: 0,
          kind: "message",
          title: path === a.path ? "needle title" : "other",
          text: `needle ${"large ".repeat(1000)}`,
          at: path === a.path ? "2025-01-01" : "2026-01-01",
        });
    };
    const page = await service.search(input, [b, a], read, () => true);
    expect(page.results[0]?.project.path).toBe(a.path);
    expect(service.evidence(input).sources).toHaveLength(20);
    expect(service.evidence(input).sources.every((s) => s.text.length <= 4000)).toBe(true);
    const source = page.results[0];
    if (!source) throw new Error("Missing source");
    expect(await service.source(input, source.id)).toEqual(source);
    await expect(service.source(input, "a".repeat(64))).rejects.toThrow("Unknown");
    expect(() => service.page(input, randomUUID())).toThrow("cursor");
    await service.cancel({ requestId: randomUUID(), databaseEpoch: 1 });
    expect(service.page(input).total).toBe(60);
    const newest = request({ kind: "message", sort: "newest" });
    expect((await service.search(newest, [a, b], read, () => true)).results[0]?.project.path).toBe(
      b.path,
    );
    expect(() => service.page(input)).toThrow(/current/);
  });

  it("uses bounded context for natural-language questions and keeps partial results usable", async () => {
    const a = await project("a");
    const missing = { path: join(root, "missing"), openedAt: "" };
    const input = request({ query: "What is the app about?" });
    const read: SearchEvidenceReader = async (_p, _q, _f, _s, add, issue) => {
      issue("One transcript is corrupt");
      add({
        id: "file:README.md",
        kind: "file",
        path: "README.md",
        title: "README.md",
        text: "This app builds palettes",
        at: "",
      });
    };
    const page = await service.search(input, [missing, a], read, () => true);
    expect(page.total).toBe(0);
    expect(page.partial).toBe(true);
    expect(page.warnings).toHaveLength(2);
    expect(service.evidence(input).sources[0]).toMatchObject({
      kind: "file",
      project: { path: a.path },
    });
    const identity = request({ query: "a", kind: "project" });
    expect((await service.search(identity, [a], reader, () => true)).results[0]?.kind).toBe(
      "project",
    );
  });

  it("refuses stale database/membership and replaced directory identities", async () => {
    const a = await project("a");
    let current = true;
    const input = request();
    const page = await service.search(input, [a], reader, () => current);
    await rename(a.path, `${a.path}-old`);
    await mkdir(a.path);
    await expect(service.source(input, page.results[0]?.id ?? "")).rejects.toThrow(
      "directory changed",
    );
    current = false;
    expect(() => service.page(input)).toThrow(/current/);
    expect(() => service.evidence(input)).toThrow(/current/);
    await service.cancel();
    expect(() => service.page(input)).toThrow("expired");
    await expect(service.search(request(), [a], reader, () => false)).rejects.toThrow(
      /database changed/,
    );
  });

  it("bounds reads at four, aborts replacement/cancellation and cleans private results", async () => {
    const projects = await Promise.all(Array.from({ length: 8 }, (_, i) => project(`p-${i}`)));
    let active = 0;
    let maximum = 0;
    const blocked: SearchEvidenceReader = async (_p, _q, _f, signal) => {
      active++;
      maximum = Math.max(maximum, active);
      try {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          if (signal.aborted) reject(signal.reason);
        });
      } finally {
        active--;
      }
    };
    const input = request();
    const pending = service.search(input, projects, blocked, () => true);
    const rejected = expect(pending).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(active).toBe(4));
    const replacement = request();
    expect((await service.search(replacement, projects, reader, () => true)).total).toBe(16);
    await rejected;
    expect(maximum).toBe(4);
    expect(active).toBe(0);
    const next = request();
    const waiting = service.search(next, projects, blocked, () => true);
    const cancelled = expect(waiting).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(active).toBe(4));
    await service.cancel(next);
    await cancelled;
    expect((await readdir(root)).filter((n) => n.startsWith("code60-project-search-"))).toEqual([]);
  });
});

it("validates narrow database-scoped query/page/source requests without paths or raw evidence", () => {
  const input = request();
  expect(parseProjectSearchQuery(input)).toEqual(input);
  for (const extra of [
    { directory: "/tmp" },
    { sources: [] },
    { databaseEpoch: -1 },
    { kind: "invalid" },
    { query: "" },
    { query: "x".repeat(2049) },
  ])
    expect(() => parseProjectSearchQuery({ ...input, ...extra })).toThrow();
  expect(() =>
    parseProjectSearchPage({ requestId: input.requestId, databaseEpoch: 1, cursor: "offset:100" }),
  ).toThrow();
  expect(() =>
    parseProjectSearchOpen({ requestId: input.requestId, databaseEpoch: 1, sourceId: "../other" }),
  ).toThrow();
});
