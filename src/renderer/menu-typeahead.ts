/** The next locale-aware first-letter match, wrapping after the current item. */
export function menuTypeahead<Item extends { textContent: string | null }>(
  items: readonly Item[],
  index: number,
  key: string,
): Item | undefined {
  const letter = key.toLocaleLowerCase();
  return [...items.slice(index + 1), ...items.slice(0, index + 1)].find((item) =>
    item.textContent?.trim().toLocaleLowerCase().startsWith(letter),
  );
}
