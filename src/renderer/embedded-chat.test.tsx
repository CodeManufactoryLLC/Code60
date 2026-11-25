import { expect, it } from "vitest";
import { ChatTurn, chatEntries } from "./embedded-chat.js";

it("keeps event IDs across backfill and streaming, retaining original authors and times", () => {
  const entries = (earlier: boolean, reply: string) =>
    chatEntries([
      earlier && (
        <button type="button" key="earlier">
          Show earlier activity
        </button>
      ),
      [
        ...(earlier
          ? [
              <ChatTurn key="0" from="assistant">
                Earlier response
              </ChatTurn>,
            ]
          : []),
        <ChatTurn key="300" from="user" at="2026-11-24T12:00:00Z">
          Request
        </ChatTurn>,
        <ChatTurn key="301" from="assistant">
          {reply}
        </ChatTurn>,
      ],
      <>
        {false}
        {null}
      </>,
    ]);
  const initial = entries(false, "Part");
  const expanded = entries(true, "Part two");
  expect(initial.size).toBe(2);
  expect(expanded.size).toBe(4);
  const [request, response] = [...initial.keys()] as [string, string];
  expect(expanded.get(request)).toEqual({
    from: "user",
    at: "2026-11-24T12:00:00Z",
    children: "Request",
  });
  expect(expanded.get(response)).toEqual({ from: "assistant", children: "Part two" });
});
