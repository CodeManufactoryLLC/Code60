/** Cryptographic v4 IDs also work on private-address HTTP, where randomUUID is absent. */
export function randomId(
  source: Pick<Crypto, "getRandomValues"> & Partial<Pick<Crypto, "randomUUID">> = crypto,
): string {
  if (source.randomUUID) return source.randomUUID();
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 15) | 64;
  bytes[8] = ((bytes[8] ?? 0) & 63) | 128;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Called only from a user Copy action. Never report success without an acknowledgement. */
export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    /* Try the user-gesture clipboard path on HTTP or permission denial. */
  }
  const previous = document.activeElement;
  const selection = document.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange(),
      )
    : [];
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.style.position = "fixed";
  field.style.opacity = "0";
  field.setAttribute("aria-hidden", "true");
  try {
    // Modal dialogs make the rest of the document inert: focus the fallback inside
    // the dialog owning the user action, otherwise copy may acknowledge stale text.
    const parent =
      previous instanceof HTMLElement
        ? (previous.closest("dialog[open]") ?? document.body)
        : document.body;
    parent.append(field);
    field.focus({ preventScroll: true });
    if (document.activeElement !== field) throw new Error("Copy focus unavailable.");
    field.select();
    if (typeof document.execCommand !== "function" || !document.execCommand("copy"))
      throw new Error("Copy denied.");
  } catch {
    throw new Error("Copy is unavailable. Select the text and copy it manually.");
  } finally {
    field.remove();
    if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
    selection?.removeAllRanges();
    for (const range of ranges) selection?.addRange(range);
  }
}
