import type { Stats } from "node:fs";
import { lstat } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import {
  createInstallationParents,
  type FileIdentity,
  installationDirectory,
  installationFileCode,
  installationSnapshot,
  lockInstallation,
  writeInstallationFile,
} from "../platform/index.js";
import {
  currentInstallation,
  installationPaths,
  readInstallation,
  shellQuote,
} from "./install-state.js";

interface ShellEdit {
  path: string;
  before: FileIdentity | null;
  append: string;
  mode: number;
}
export interface ShellPreview {
  installationId: string;
  root: string;
  launcher: string;
  shell: "bash" | "zsh" | "fish" | "unknown";
  edits: ShellEdit[];
  manual: string[];
  currentSessionCommand: string;
  newTerminal: string;
}
function fishQuote(value: string) {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}
async function verifyProfileParent(path: string) {
  let parent = dirname(path);
  let info: Stats | null = null;
  while (!info) {
    info = await lstat(parent).catch((error: unknown) => {
      if (installationFileCode(error) !== "ENOENT") throw error;
      return null;
    });
    if (!info) parent = dirname(parent);
  }
  await installationDirectory(parent);
  if (info.uid !== process.getuid?.() || (info.mode & 0o300) !== 0o300)
    throw new Error("Profile parent is foreign or read-only");
}
export async function planShellIntegration(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ShellPreview> {
  const paths = await installationPaths(env);
  const record = await readInstallation(paths);
  if (!record || !(await currentInstallation(record)))
    throw new Error("Install Code60 before planning shell changes");
  const name = env.SHELL?.split("/").at(-1);
  const shell =
    env.SHELL && isAbsolute(env.SHELL) && ["bash", "zsh", "fish"].includes(name ?? "")
      ? (name as "bash" | "zsh" | "fish")
      : "unknown";
  const preview: ShellPreview = {
    installationId: record.id,
    root: record.root,
    launcher: record.launcher,
    shell,
    edits: [],
    manual: [],
    currentSessionCommand:
      shell === "fish"
        ? `if not contains -- ${fishQuote(record.bin)} $PATH; set -gx PATH ${fishQuote(record.bin)} $PATH; end`
        : shell === "unknown"
          ? `Add ${record.bin} to your shell's PATH. Use ${record.launcher} directly.`
          : `case ":$PATH:" in *:${shellQuote(record.bin)}:*) ;; *) export PATH=${shellQuote(record.bin)}:"$PATH" ;; esac`,
    newTerminal:
      "Open a new terminal after accepting profile changes; this process cannot change its parent shell.",
  };
  if (shell === "unknown") {
    preview.manual.push("Unsupported or ambiguous shell; configure PATH manually.");
    return preview;
  }
  if ((env.PATH ?? "").split(":").includes(record.bin)) return preview;
  const files: string[] = [];
  if (shell === "bash") {
    for (const file of [".bash_profile", ".bash_login", ".profile"]) {
      const present = await lstat(join(paths.home, file)).catch((error: unknown) => {
        if (installationFileCode(error) !== "ENOENT") throw error;
        return null;
      });
      if (present) {
        files.push(join(paths.home, file));
        break;
      }
    }
    if (!files.length) files.push(join(paths.home, ".profile"));
    files.push(join(paths.home, ".bashrc"));
  } else if (shell === "zsh") {
    const directory = env.ZDOTDIR || paths.home;
    if (!isAbsolute(directory)) {
      preview.manual.push("Relative ZDOTDIR is ambiguous; configure PATH manually.");
      return preview;
    }
    for (const path of new Set([join(paths.home, ".zshenv"), join(directory, ".zshenv")])) {
      try {
        const file = await installationSnapshot(path);
        if (file && /\b(?:ZDOTDIR|RCS|GLOBAL_RCS)\b/.test(file.text.replace(/^\s*#.*$/gm, ""))) {
          preview.manual.push("zsh startup redirects its startup files; configure PATH manually.");
          return preview;
        }
      } catch {
        preview.manual.push(
          "zsh startup ownership/location is ambiguous; configure PATH manually.",
        );
        return preview;
      }
    }
    files.push(join(directory, ".zprofile"), join(directory, ".zshrc"));
  } else {
    const directory = env.XDG_CONFIG_HOME || join(paths.home, ".config");
    if (!isAbsolute(directory)) {
      preview.manual.push("Relative XDG_CONFIG_HOME is unsafe; configure fish PATH manually.");
      return preview;
    }
    files.push(join(directory, "fish/config.fish"));
  }
  for (const path of files) {
    try {
      await verifyProfileParent(path);
      // Missing parent directories are allowed in a preview; application rechecks and creates them.
      let file = null;
      try {
        file = await installationSnapshot(path);
      } catch (error) {
        if (
          installationFileCode(error) !== "ENOENT" &&
          !(error instanceof Error && error.message === "Unsafe installation directory")
        )
          throw error;
        if (await lstat(path).catch(() => null)) throw error;
      }
      if (file && !(file.identity.mode & 0o200)) throw new Error("Profile is read-only");
      const before = file?.text ?? "";
      const newline = before.includes("\r\n") ? "\r\n" : "\n";
      if (
        before.replaceAll("\r\n", "").includes("\r") ||
        (newline === "\r\n" && before.replaceAll("\r\n", "").includes("\n"))
      )
        throw new Error("Ambiguous profile newline style");
      const begin = `# >>> code60 PATH ${record.id} >>>`;
      const end = `# <<< code60 PATH ${record.id} <<<`;
      const lines =
        shell === "fish"
          ? [
              begin,
              `if not contains -- ${fishQuote(record.bin)} $PATH`,
              `  set -gx PATH ${fishQuote(record.bin)} $PATH`,
              "end",
              end,
            ]
          : [
              begin,
              `case ":$PATH:" in`,
              `  *:${shellQuote(record.bin)}:*) ;;`,
              `  *) export PATH=${shellQuote(record.bin)}:"$PATH" ;;`,
              "esac",
              end,
            ];
      const block = lines.join(newline) + newline;
      if (before.includes("# >>> code60 PATH") || before.includes("# <<< code60 PATH")) {
        if (
          before.split(block).length === 2 &&
          before.split("# >>> code60 PATH").length === 2 &&
          before.split("# <<< code60 PATH").length === 2
        )
          continue;
        throw new Error("Existing PATH block was modified or has unknown ownership");
      }
      const contents = before + (before && !before.endsWith("\n") ? newline : "") + block;
      if (Buffer.byteLength(contents) > 1024 * 1024)
        throw new Error("Profile exceeds 1 MiB preview limit");
      preview.edits.push({
        path,
        before: file?.identity ?? null,
        append: (before && !before.endsWith("\n") ? newline : "") + block,
        mode: file?.identity.mode ?? 0o600,
      });
    } catch (error) {
      preview.manual.push(
        `${path}: ${error instanceof Error ? error.message : "Profile cannot be edited safely"}`,
      );
    }
  }
  return preview;
}
export async function applyShellIntegration(
  preview: ShellPreview,
  consent: { approved: boolean; interactive: boolean },
) {
  if (!consent.approved || !consent.interactive)
    return {
      applied: [] as string[],
      manual: [
        ...preview.manual,
        "Profile files were not changed; use the printed PATH instructions.",
      ],
      currentSessionCommand: preview.currentSessionCommand,
    };
  const recordFile = await installationSnapshot(
    join(preview.root, "installation.json"),
    16_384,
    true,
  );
  if (!recordFile) throw new Error("Installation receipt is missing");
  const raw = JSON.parse(recordFile.text) as { home: string; bin: string; launcher: string };
  const record = await readInstallation({ ...raw, root: preview.root });
  if (
    !record ||
    record.id !== preview.installationId ||
    record.launcher !== preview.launcher ||
    preview.edits.length > 2
  )
    throw new Error("Shell preview ownership changed");
  const release = await lockInstallation(preview.root);
  const applied: string[] = [];
  const manual = [...preview.manual];
  try {
    const receiptPath = join(preview.root, "shell.json");
    let saved = await installationSnapshot(receiptPath, 65_536, true);
    const receipts = saved
      ? (JSON.parse(saved.text) as Record<string, { hash: string; marker: string }>)
      : {};
    for (const edit of preview.edits) {
      try {
        await createInstallationParents(dirname(edit.path));
        // Recompute the approved mutation from the current snapshot rather than trusting arbitrary preview content.
        const env = {
          HOME: record.home,
          XDG_DATA_HOME: dirname(record.root),
          SHELL: `/bin/${preview.shell}`,
          PATH: "",
          ...(preview.shell === "zsh" ? { ZDOTDIR: dirname(edit.path) } : {}),
          ...(preview.shell === "fish" ? { XDG_CONFIG_HOME: dirname(dirname(edit.path)) } : {}),
        };
        const fresh = await planShellIntegration(env);
        const expected = fresh.edits.find((item) => item.path === edit.path);
        if (
          !expected ||
          expected.append !== edit.append ||
          JSON.stringify(expected.before) !== JSON.stringify(edit.before)
        )
          throw new Error("Profile changed since preview");
        const snapshot = await installationSnapshot(edit.path);
        const identity = await writeInstallationFile(
          edit.path,
          (snapshot?.text ?? "") + edit.append,
          edit.before,
          edit.mode,
        );
        applied.push(edit.path);
        receipts[edit.path] = { hash: identity.hash, marker: record.id };
        await writeInstallationFile(receiptPath, JSON.stringify(receipts), saved?.identity ?? null);
        saved = await installationSnapshot(receiptPath, 65_536, true);
      } catch (error) {
        manual.push(
          `${edit.path}: ${error instanceof Error ? error.message : "Profile edit failed"}`,
        );
        break;
      }
    }
  } finally {
    await release();
  }
  return { applied, manual, currentSessionCommand: preview.currentSessionCommand };
}
