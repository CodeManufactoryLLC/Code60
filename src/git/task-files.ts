/** Defaults apply only to untracked files; tracked project files always remain included. */
export function taskFileExclusion(path: string): string | undefined {
  const parts = path.toLowerCase().split("/");
  const name = parts.at(-1) ?? "";
  if (parts.includes(".code60_workspace") || parts.includes(".git")) return "Code60 or Git storage";
  if (
    parts.some((part) =>
      [
        "node_modules",
        ".venv",
        "venv",
        "__pycache__",
        "dist",
        "build",
        "target",
        ".next",
        "coverage",
      ].includes(part),
    )
  )
    return "Generated files";
  if (
    (/^\.env(?:\.|$)/.test(name) && !/\.(example|sample|template)$/.test(name)) ||
    /\.(pem|key|p12|pfx)$/.test(name) ||
    ["id_rsa", "id_ed25519", "credentials.json"].includes(name)
  )
    return "Credential file";
  return undefined;
}
