import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { NavigationIcon } from "./navigation-icons.js";

// SHA-256 of the original SVGs in the integrity-verified Phosphor 2.1.1 archive.
it.each([
  ["chat-circle", "cee51ebf9726123b5fcb4139300dcf7f1bc5cb50373db7cb6f5e45a64a87fe3c"],
  ["arrow-elbow-down-right", "fdfedc5fd6fff889356e9a3a6ee31c3ec84eda4bc19905603ac254b8cd70590f"],
  ["house", "bd9f3502ab7d63c3cc8a3cf91657e5974188ede3bd1ac7249333d9ce5d0d932f"],
  ["clipboard", "74209f3f2dd9664aae3dd29263f7b600850952406773dcec8923055309ab9e5d"],
  ["pencil-line", "1f9d6e4bf93778b443eb39628c0785a849632d158df229edb89530ef305b0a2c"],
  ["megaphone", "04f73a1727252b5650265cb294d713988c5b353e83714c8674d64376170f678c"],
  ["gear", "844f6e041e4622283f651e76882c784af0627f950a6a2536e923b12e4ae5e590"],
  ["magnifying-glass", "7a840ea2341e75cf1d9187e07223be4501d6c6078a064a4097be07c1b3a52fb6"],
  ["database", "2543df52f9d509307cd7d08d8bf2ba9033aa23207791c32e2526841ef869ea1c"],
  ["arrows-clockwise", "32e3d1e35733d6ad0f9c03286ca756deb142e43f9cda1e5f36c3e3896b5d37ae"],
  ["brain", "21c4456e71486b819599cc5feecde1451dc172c82f40ae10f8469f434567979b"],
  ["chat-text", "f84ad7bc571555c94dd89282b34e1174ee4d58a2c3246ba84f85ef7023204c6e"],
  ["code", "bafb91fe5a241756d0102490d48d7146c74e81831414a6f6d3792835c5f65ed1"],
  ["download-simple", "68ffe027868f3e33b2788d5cc246dbcb47a86f210b39a2866ab7e2d1cddee9a4"],
  ["flask", "3a2a8b78037461d9f85645bfdfc1164b3fe9d773e854fe034f96eab9c3494099"],
  ["git-branch", "1ffc8cfe3f4545d4fdda3af028a238353d4ff063cdb0933ff7cfca22bdbe2f65"],
  ["info", "dec9ea1394c618d6d576ba43e0f08eea265eaf20046e98bc3da19eb4b8da73e8"],
  ["lightning", "aab43bf156d9047ff4002359cecedc867c8e3fecd9d1475635ea4e7b8416267c"],
  ["list-bullets", "1f4c9a2353c05b2d3314959b2d7604c0a20c77e8bc3e35f8ed28fdb2217518b0"],
  ["palette", "f88e53a831d175ba02b0ba49d8be24be22963a1522cd8e55bf07d02897b8c7eb"],
  ["robot", "7674bf6dd6c2a4f09bbf3989e915e17edd9804c45e14d0a95edadc5505fda1b3"],
  ["sliders-horizontal", "76260b62780cba20278d8c45eb9107801090414b0fbb8a6b67c97860664d7237"],
  ["table", "9d5d194de48b3983c3e666fe8e1089cad925adbde10477f0908066f38b919c71"],
  ["terminal-window", "b2ec046efc1d26eb65403a18ee340892339842af943d24ad337ded935d2e5df2"],
  ["text-aa", "edf4791e1426a24710e6c1ddb207be6012428b2f6cf9147fc9af13bbd20a5e3f"],
  ["wrench", "67c0b89c2688777cc25a14a7f78c39fc5463f7bc5257f1393f46d48b36422716"],
] as const)(
  "retains official %s duotone geometry without an accessible-name duplicate",
  async (name, hash) => {
    const html = renderToStaticMarkup(<NavigationIcon name={name} />);
    expect(html).toContain('viewBox="0 0 256 256"');
    expect(html).toContain('width="1em" height="1em"');
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
