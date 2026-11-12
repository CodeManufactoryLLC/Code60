import { expect, it, vi } from "vitest";
import type { DesktopApi } from "../bridge/index.js";
import { bindDatabaseWrites } from "./database-api.js";

it("keeps delayed database actions on their captured epoch rather than a replacement", async () => {
  const methods = [
    "connectDatabase",
    "openProject",
    "removeProject",
    "saveConfiguration",
    "deleteConfiguration",
    "saveCommand",
    "deleteCommand",
    "savePromptTemplate",
    "resetPromptTemplate",
  ] as const;
  const api = Object.fromEntries(methods.map((method) => [method, vi.fn(async () => "result")]));
  const snapshot = vi.fn();
  const raw = { ...api, snapshot } as unknown as DesktopApi;
  const old = bindDatabaseWrites(raw, 7);
  const next = bindDatabaseWrites(raw, 8);
  for (const method of methods) {
    const request = { opaque: method };
    const invoke = old[method] as (value: unknown) => Promise<unknown>;
    expect(await invoke(request)).toBe("result");
    expect(api[method]).toHaveBeenLastCalledWith(request, 7);
    await (next[method] as typeof invoke)(request);
    expect(api[method]).toHaveBeenLastCalledWith(request, 8);
    await invoke(request);
    expect(api[method]).toHaveBeenLastCalledWith(request, 7);
  }
  expect(old.snapshot).toBe(snapshot);
  expect(snapshot).not.toHaveBeenCalled();
  expect(bindDatabaseWrites(raw, undefined)).toBe(raw);
});

it("captures epochs for native folder picking and project-history clearing without a payload", async () => {
  const chooseFolder = vi.fn(async () => true);
  const clearProjects = vi.fn(async () => false);
  const raw = { chooseFolder, clearProjects } as unknown as DesktopApi;
  const old = bindDatabaseWrites(raw, 7);
  const next = bindDatabaseWrites(raw, 8);
  for (const method of ["chooseFolder", "clearProjects"] as const) {
    await old[method]();
    expect(raw[method]).toHaveBeenLastCalledWith(7);
    await next[method]();
    expect(raw[method]).toHaveBeenLastCalledWith(8);
    await old[method]();
    expect(raw[method]).toHaveBeenLastCalledWith(7);
  }
});
