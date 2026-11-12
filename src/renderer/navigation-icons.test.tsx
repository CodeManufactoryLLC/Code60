import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { NavigationIcon } from "./navigation-icons.js";

// SHA-256 of the original SVGs in the integrity-verified Phosphor 2.1.1 archive.
it.each([
  ["chats", "e39ee9ab9d89128206ae31907d7c93e46ff5b96e67ad0e3a47b5fb80eba4c6d5"],
  ["pencil-line", "1f9d6e4bf93778b443eb39628c0785a849632d158df229edb89530ef305b0a2c"],
  ["megaphone", "04f73a1727252b5650265cb294d713988c5b353e83714c8674d64376170f678c"],
  ["gear", "844f6e041e4622283f651e76882c784af0627f950a6a2536e923b12e4ae5e590"],
  ["magnifying-glass", "7a840ea2341e75cf1d9187e07223be4501d6c6078a064a4097be07c1b3a52fb6"],
  ["database", "2543df52f9d509307cd7d08d8bf2ba9033aa23207791c32e2526841ef869ea1c"],
] as const)(
  "retains official %s duotone geometry without an accessible-name duplicate",
  async (name, hash) => {
    const html = renderToStaticMarkup(<NavigationIcon name={name} />);
    expect(html).toContain('viewBox="0 0 256 256"');
    expect(html).toContain('width="1.5em" height="1.5em"');
    expect(html).toContain('aria-hidden="true" focusable="false"');
    expect(html).not.toMatch(/<title|aria-label|href=|<image/);
    const paths = [...html.matchAll(/<path d="([^"]+)"[^>]*>/g)].map((match) => match[1]);
    expect(paths).toHaveLength(2);
    expect(html).toContain('opacity="0.2"');
    const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="${paths[0]}" opacity="0.2"/><path d="${paths[1]}"/></svg>`;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
    const actual = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    expect(actual).toBe(hash);
  },
);
