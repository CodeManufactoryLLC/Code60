import { join } from "node:path";
import {
  absoluteInstallationPath,
  type FileIdentity,
  installationSnapshot,
  lockInstallation,
  writeInstallationFile,
} from "../platform/index.js";
import { type InstallationRecord, readInstallation } from "./install-state.js";

export interface ShellRemovalPreview {
  installationId: string;
  root: string;
  edits: { path: string; before: FileIdentity; remove: string; mode: number }[];
  manual: string[];
}
interface ShellReceipt {
  marker: string;
  hash: string;
  append?: string;
}
async function receipts(record: InstallationRecord) {
  const snapshot = await installationSnapshot(join(record.root, "shell.json"), 65_536, true);
  const values = snapshot ? (JSON.parse(snapshot.text) as Record<string, ShellReceipt>) : {};
  if (
    !values ||
    typeof values !== "object" ||
    Array.isArray(values) ||
    Object.keys(values).length > 32
  )
    throw Error("Shell ownership receipt is invalid; preserve profiles");
  for (const [path, value] of Object.entries(values)) {
    if (
      absoluteInstallationPath(path) !== path ||
      !value ||
      value.marker !== record.id ||
      !/^[a-f0-9]{64}$/.test(value.hash) ||
      (value.append !== undefined &&
        (typeof value.append !== "string" || value.append.length > 8192))
    )
      throw Error("Shell ownership receipt is invalid; preserve profiles");
  }
  return { snapshot, values };
}

/** An exact removal preview never executes a profile and never includes its unrelated contents. */
export async function planShellRemoval(record: InstallationRecord): Promise<ShellRemovalPreview> {
  const owned = await readInstallation(record);
  if (!owned || owned.id !== record.id) throw Error("Shell removal installation changed");
  const preview: ShellRemovalPreview = {
    installationId: record.id,
    root: record.root,
    edits: [],
    manual: [],
  };
  const { values } = await receipts(record);
  for (const [path, receipt] of Object.entries(values)) {
    try {
      if (preview.edits.length >= 2)
        throw Error("Preview is limited to two profiles; remove remaining additions manually");
      const file = await installationSnapshot(path);
      if (!file) continue;
      if (!(file.identity.mode & 0o200)) throw Error("Profile is read-only");
      const begin = `# >>> code60 PATH ${record.id} >>>`;
      const end = `# <<< code60 PATH ${record.id} <<<`;
      if (!file.text.includes(begin) && !file.text.includes(end)) continue;
      // Receipts created before append fingerprints require the whole-file hash.
      // A modified or ambiguous block is always retained for manual inspection.
      let remove = receipt.append;
      if (remove === undefined && file.identity.hash === receipt.hash) {
        const start = file.text.indexOf(begin);
        const finish = file.text.indexOf(end, start) + end.length;
        remove =
          file.text.slice(start, finish) +
          (file.text.slice(finish).startsWith("\r\n") ? "\r\n" : "\n");
      }
      if (
        !remove?.includes(begin) ||
        !remove.includes(end) ||
        remove.split(begin).length !== 2 ||
        remove.split(end).length !== 2 ||
        file.text.split(remove).length !== 2 ||
        file.text.split(begin).length !== 2 ||
        file.text.split(end).length !== 2
      )
        throw Error("Owned PATH addition changed or is ambiguous; preserve the profile");
      preview.edits.push({ path, before: file.identity, remove, mode: file.identity.mode });
    } catch (error) {
      preview.manual.push(
        `${path}: ${error instanceof Error ? error.message : "Profile cannot be inspected"}`,
      );
    }
  }
  return preview;
}

export async function applyShellRemoval(
  record: InstallationRecord,
  preview: ShellRemovalPreview,
  consent: { approved: boolean; interactive: boolean },
) {
  if (!consent.approved || !consent.interactive)
    return {
      applied: [] as string[],
      manual: [
        ...preview.manual,
        "Profile additions were retained; remove the printed owned blocks manually.",
      ],
    };
  if (
    preview.installationId !== record.id ||
    preview.root !== record.root ||
    preview.edits.length > 2
  )
    throw Error("Shell removal preview ownership changed");
  const release = await lockInstallation(record.root);
  const applied: string[] = [];
  const manual = [...preview.manual];
  try {
    let saved = await receipts(record);
    for (const edit of preview.edits) {
      try {
        const fresh = await planShellRemoval(record);
        const expected = fresh.edits.find((item) => item.path === edit.path);
        if (!expected || JSON.stringify(expected) !== JSON.stringify(edit))
          throw Error("Profile changed since preview");
        const file = await installationSnapshot(edit.path);
        if (!file) throw Error("Profile disappeared since preview");
        await writeInstallationFile(
          edit.path,
          file.text.replace(edit.remove, ""),
          edit.before,
          edit.mode,
        );
        applied.push(edit.path);
        delete saved.values[edit.path];
        await writeInstallationFile(
          join(record.root, "shell.json"),
          JSON.stringify(saved.values),
          saved.snapshot?.identity ?? null,
        );
        saved = await receipts(record);
      } catch (error) {
        manual.push(
          `${edit.path}: ${error instanceof Error ? error.message : "Profile removal failed"}`,
        );
        break;
      }
    }
  } finally {
    await release();
  }
  return { applied, manual };
}
