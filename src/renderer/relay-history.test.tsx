import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { RelayHistoryMessages, readOriginalRelayMessage } from "./relay-history.js";

it("shares message presentation and Copy only for complete historical source", () => {
  const html = renderToStaticMarkup(
    <RelayHistoryMessages
      history={{
        serialized: "Not a live prompt",
        characters: 100,
        cursor: null,
        older: true,
        incomplete: false,
        messages: [
          { id: "human", role: "human", at: "", text: "  exact source\n" },
          { id: "agent", role: "assistant", at: "", text: "**Historical reply**" },
          { id: "partial", role: "assistant", at: "", text: "Tail only", partial: true },
          { id: "activity", role: "activity", at: "", text: "Historical activity" },
        ],
      }}
      openLink={async () => true}
      visible={false}
    />,
  );
  expect(html).toContain("  exact source\n");
  expect(html).toContain("<strong>Historical reply</strong>");
  expect(html).toContain("Partial excerpt");
  expect(html).toContain("Historical activity");
  expect(html.match(/aria-label="Copy message"/g)).toHaveLength(2);
});

it("keeps older snapshots readable without interpreting serialized history as markup", () => {
  const html = renderToStaticMarkup(
    <RelayHistoryMessages
      history={{
        serialized: "<script>source</script>",
        characters: 23,
        cursor: null,
        older: false,
        incomplete: false,
      }}
      openLink={async () => true}
      visible={false}
    />,
  );
  expect(html).toContain("&lt;script&gt;source&lt;/script&gt;");
});

it("shows original-source Copy only when an excerpt has an opaque source capability", async () => {
  const readMessage = vi.fn(async () => ({ text: "Original", cursor: null }));
  const html = renderToStaticMarkup(
    <RelayHistoryMessages
      history={{
        serialized: "Tail",
        characters: 4,
        cursor: null,
        older: true,
        incomplete: false,
        messages: [
          {
            id: "partial",
            role: "assistant",
            at: "",
            text: "Tail",
            partial: true,
            source: crypto.randomUUID(),
          },
        ],
      }}
      openLink={async () => true}
      conversationId={crypto.randomUUID()}
      readMessage={readMessage}
      visible={false}
    />,
  );
  expect(html).toContain('aria-label="Copy original message"');
  expect(html).toContain("Copy retrieves the original message.");
  expect(readMessage).not.toHaveBeenCalled();
});

it("assembles only source text after bounded seek pages and propagates failures", async () => {
  const request = { conversationId: crypto.randomUUID(), source: crypto.randomUUID() };
  const cursor = crypto.randomUUID();
  const forward = crypto.randomUUID();
  const read = vi
    .fn()
    .mockResolvedValueOnce({ text: "", cursor })
    .mockResolvedValueOnce({ text: "  head 😀\n", cursor: forward })
    .mockResolvedValueOnce({ text: "tail\t\n", cursor: null });
  expect(await readOriginalRelayMessage(read, request)).toBe("  head 😀\ntail\t\n");
  expect(read.mock.calls).toEqual([
    [request],
    [{ ...request, cursor }],
    [{ ...request, cursor: forward }],
  ]);
  await expect(
    readOriginalRelayMessage(async () => {
      throw new Error("Expired source");
    }, request),
  ).rejects.toThrow("Expired source");
});
