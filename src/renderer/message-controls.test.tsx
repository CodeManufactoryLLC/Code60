import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TurnTiming } from "./chat-presentation.js";
import { TurnTimer } from "./message-controls.js";

const completed: TurnTiming = {
  key: "0",
  turn: 1,
  start: 0,
  end: 12_000,
  outcome: "finished",
  active: false,
};

describe("completed turn separators", () => {
  it("places a separator immediately below a completed worker timing notice", () => {
    const html = renderToStaticMarkup(<TurnTimer timing={completed} visible={false} />);
    expect(html).toBe(
      '<p class="turn-timer" aria-live="off">Worked for 12s (finished)</p><hr class="turn-separator"/>',
    );
  });

  it.each([true, false])(
    "keeps the separator outside the activity disclosure button (expanded: %s)",
    (expanded) => {
      const html = renderToStaticMarkup(
        <TurnTimer
          timing={completed}
          visible={false}
          disclosure={{ id: "turn", controls: "details", expanded, toggle: () => {} }}
        />,
      );
      expect(html).toContain('class="turn-timer activity-history-toggle"');
      expect(html).toContain(`aria-expanded="${expanded}"`);
      expect(html).toContain('aria-controls="details"');
      expect(html).toContain("Worked for 12s (finished)</button><hr");
      expect(html.match(/class="turn-separator"/g)).toHaveLength(1);
    },
  );

  it("does not add a separator for an active or absent timing notice", () => {
    const active = renderToStaticMarkup(
      <TurnTimer timing={{ ...completed, active: true }} visible={false} />,
    );
    expect(active).toContain("Working for");
    expect(active).not.toContain("<hr");
    expect(renderToStaticMarkup(<TurnTimer timing={undefined} visible={false} />)).toBe("");
  });
});
