# Neobrutalism primitives

Adapted from [Neobrutalism Card](https://www.neobrutalism.dev/docs/card),
[registry source](https://www.neobrutalism.dev/r/card.json), retrieved 2026-11-19.
Registry SHA-256: `32798f407f3faaaddf9ea12012ee1b131d0935eefe260f08ed081ee6d4a91347`.
Copyright (c) 2023 Samuel Breznjak. See [MIT license](LICENSE).

Card, CardHeader, CardContent, CardTitle and CardAction support the existing
navigation/sidebar, content, breadcrumb, conversation/composer and inspector
shells, and quiet worker approval Cards. Card accepts div, section or aside and forwards their native props/refs.
Local adaptations: `nb:` Tailwind prefix, `--nb-card-spacing` layout variable,
explicit border style/box sizing because Preflight is absent, span-compatible
parts inside native buttons, and simple class joining without runtime dependencies.
Code60's navigation adapters supply the main-content gallery and all five sidebar
group containers, preserving their layout, artwork and native actions,
text roles, pressed/focus and accessibility behavior. The Card owns the 2px outline with 5px corners, live theme fill/text and 4px hard shadow.

`theme.css` imports theme variables and utilities only, never Preflight. Explicit
sources limit generated classes to these primitives and the navigation adapter.
The dedicated neobrutalism layer precedes application components; accessibility
stays last. Inline aliases resolve against live Code60 theme/preferences, including
forced colors. The upstream layout spacing variable is renamed to avoid colliding
with Code60's saved `--card-spacing` letter spacing. No palette, font, reset,
remote asset, runtime CSS fetch, Base UI or global button replacement is installed.

Chat and breadcrumb primitives were adapted from the same MIT registry on
2026-11-19. Registry source and SHA-256:

| Primitive | Source | SHA-256 |
| --- | --- | --- |
| Button | [button.json](https://www.neobrutalism.dev/r/button.json) | `b6c59a12da75416229d85688aea63d4e5a2760d5d8ffa3c8f4eb8021e7b3df3b` |
| Textarea | [textarea.json](https://www.neobrutalism.dev/r/textarea.json) | `acbbabdef1930f9bf67a41bdc92994157c907bd2a709a6a8b728b115be414b0f` |
| Breadcrumb | [breadcrumb.json](https://www.neobrutalism.dev/r/breadcrumb.json) | `f956b4455da3f3fcab6b5506a67b16a0d98f76c45e28c16d27b44fbde3ec1c2a` |
| Scroll Area | [scroll-area.json](https://www.neobrutalism.dev/r/scroll-area.json) | `1ab9757d32e2e54311aef9f85104ffcb8502124683f5caf5a74cc23fd9294146` |
| Bubble | [bubble.json](https://www.neobrutalism.dev/r/bubble.json) | `8d0fe5ff307a918e4aa7b99b55bc33fca38e29762f48eba9ed1b0baa5aecd1e5` |

Only the used parts/variants are vendored. Button keeps native HTML semantics in
place of Base UI; variants use simple class joining instead of CVA. Hover stays
stationary, pressed offset stays 1px, and focus uses live system/theme colors.
No fixed upstream font sizes or opacity rules override saved Code60 text roles
or disabled treatment. Breadcrumb keeps the existing native navigation buttons,
heading/current-page semantics and inert portal marker; no anchor emulation or
ellipsis is introduced. BubbleContent defaults to a preformatted human element; its agent variant renders
a div around semantic ChatMarkdown. Separate live theme tokens color human and
agent fills/text. Both retain 5px corners and 2px outlines without shadows or
avatars, keeping timestamp/Copy/Undo outside. The agent inset preserves compact
divider spacing and metadata alignment. Composer fields remain borderless inside their Card, and
composer chrome aliases its existing fill/edge/shadow through local Card tokens.
Unrelated buttons/fields/menus are untouched. Accessibility overrides remain last;
forced colors removes shadows and reduced motion removes button displacement.
This adds no capability, setting or persistent schema; no catalog change is needed.

Scroll Area adapts the upstream compact solid rounded thumb to the native chat
viewport rather than introducing Base UI or replacing the existing scroll/ref
lifecycle. Native wheel, drag, keyboard, focus, streaming follow and saved positions
remain authoritative. Its visible thumb uses the live control edge for contrast;
forced colors keeps the system scrollbar. The viewport spans the conversation
Card to its inner edge while inner message/composer widths retain their reading
column. Other app scrollbars are unchanged.
