/** Native root labels only. Browser-relative file paths remain slash-separated. */
export function pathLabel(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
