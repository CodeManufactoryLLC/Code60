import { cp, lstat, mkdir, readdir, readlink, rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { sha256 } from "./acquire.mjs";

export function nativeAllowed(path, os, arch) {
  const onnx = /(?:^|\/)onnxruntime-node\/bin\/napi-v\d+\/([^/]+)\/([^/]+)/.exec(path);
  if (onnx && (onnx[1] !== os || onnx[2] !== arch)) return false;
  return !/(?:^|\/)(?:\.cache|\.npm|\.git|\.DS_Store)(?:\/|$)/.test(path);
}
export async function pruneNative(root, os, arch) {
  async function walk(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (!nativeAllowed(relative(root, path).split(sep).join("/"), os, arch))
        await rm(path, { recursive: true });
      else if (item.isDirectory()) await walk(path);
    }
  }
  await walk(root);
}
export async function inventory(root) {
  const files = [];
  async function walk(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const file = join(directory, name);
      const path = relative(root, file).split(sep).join("/");
      const info = await lstat(file);
      if (info.isDirectory()) await walk(file);
      else if (info.isFile())
        files.push({ path, type: "0", size: info.size, sha256: await sha256(file) });
      else if (info.isSymbolicLink()) {
        const link = await readlink(file);
        const target = resolve(directory, link);
        if (!target.startsWith(`${resolve(root)}${sep}`))
          throw new Error("Escaping staged dependency link");
        files.push({ path, type: "2", link });
      } else throw new Error("Unsupported staged dependency file");
    }
  }
  await walk(root);
  return files;
}
export async function inventoryDirectories(root) {
  const directories = [];
  async function walk(directory) {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (!item.isDirectory()) continue;
      const path = join(directory, item.name);
      directories.push(relative(root, path).split(sep).join("/"));
      await walk(path);
    }
  }
  await walk(root);
  return directories.sort();
}
export async function notices(directory, output, prefix = "") {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    const target = join(prefix, item.name);
    if (item.isDirectory()) await notices(path, output, target);
    else if (
      item.isFile() &&
      /^(licen[cs]e|notice|copying|ofl)(\.|$)|upstream-license/i.test(item.name)
    ) {
      await mkdir(join(output, prefix), { recursive: true });
      await cp(path, join(output, target));
    }
  }
}
