export const limits = Object.freeze({
  download: 2 * 1024 ** 3,
  expanded: 8 * 1024 ** 3,
  entries: 200_000,
  path: 4096,
});
export const targets = ["darwin-arm64", "linux-x64"];
export const nodeRange = ">=24.22.0 <25";
export function platform(host = process) {
  const target = `${host.platform}-${host.arch}`;
  if (!targets.includes(target)) throw new Error("Payload requires macOS arm64 or Linux x64");
  const [major, minor] = host.versions.node.split(".").map(Number);
  if (major !== 24 || minor < 22) throw new Error(`Payload requires Node ${nodeRange}`);
  if (host.platform === "linux" && !host.report.getReport().header.glibcVersionRuntime)
    throw new Error("Linux payload requires glibc; musl is unsupported");
  return target;
}
export function descriptor(value) {
  if (
    value?.schemaVersion !== 1 ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.version) ||
    !/^[a-f0-9]{40}$/.test(value.commit) ||
    typeof value.dirty !== "boolean" ||
    !targets.includes(`${value.os}-${value.arch}`) ||
    value.runtime?.node !== nodeRange ||
    value.runtime?.libc !== (value.os === "linux" ? "glibc" : null)
  )
    throw new Error("Invalid payload identity/runtime descriptor");
  const name = `code60-${value.version}-${value.os}-${value.arch}.tar.gz`;
  if (
    value.archive?.name !== name ||
    !Number.isSafeInteger(value.archive.size) ||
    value.archive.size <= 0 ||
    value.archive.size > limits.download ||
    !/^[a-f0-9]{64}$/.test(value.archive.sha256) ||
    value.archive.url !==
      `https://github.com/CodeManufactoryLLC/Code60/releases/download/v${value.version}/${name}`
  )
    throw new Error("Invalid payload archive descriptor");
  return value;
}
export function descriptorPair(values, version) {
  if (values.length !== 2) throw new Error("Both platform descriptors are required");
  values.forEach(descriptor);
  if (
    new Set(values.map((v) => `${v.os}-${v.arch}`)).size !== 2 ||
    values.some(
      (v) => v.version !== version || v.commit !== values[0].commit || v.dirty !== values[0].dirty,
    )
  )
    throw new Error("Platform descriptors must match version, commit and provenance");
  return Object.fromEntries(values.map((v) => [`${v.os}-${v.arch}`, v]));
}
