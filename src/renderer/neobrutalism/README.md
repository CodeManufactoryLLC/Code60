# Neobrutalism Card primitives

Adapted from [Neobrutalism Card](https://www.neobrutalism.dev/docs/card),
[registry source](https://www.neobrutalism.dev/r/card.json), retrieved 2026-11-19.
Registry SHA-256: `32798f407f3faaaddf9ea12012ee1b131d0935eefe260f08ed081ee6d4a91347`.
Copyright (c) 2023 Samuel Breznjak. See [MIT license](LICENSE).

Only Card, CardHeader, CardContent, CardTitle and CardAction are needed here.
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
