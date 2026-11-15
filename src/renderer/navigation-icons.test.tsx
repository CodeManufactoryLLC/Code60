import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import aiSource from "./icons/apps/ai.svg?raw";
import analyzeSource from "./icons/apps/analyze.svg?raw";
import appsSource from "./icons/apps/apps.svg?raw";
import backlogSource from "./icons/apps/backlog.svg?raw";
import bookshelfSource from "./icons/apps/bookshelf.svg?raw";
import chemicalSource from "./icons/apps/chemical.svg?raw";
import cloudSource from "./icons/apps/cloud-computing.svg?raw";
import cogwheelSource from "./icons/apps/cogwheel.svg?raw";
import paletteSource from "./icons/apps/color-palette.svg?raw";
import communicationSource from "./icons/apps/communication.svg?raw";
import databaseSource from "./icons/apps/database.svg?raw";
import downRightSource from "./icons/apps/down-right.svg?raw";
import folderSource from "./icons/apps/folder.svg?raw";
import heartRateSource from "./icons/apps/heart-rate.svg?raw";
import helmetSource from "./icons/apps/helmet.svg?raw";
import homeSource from "./icons/apps/home2.svg?raw";
import infoSource from "./icons/apps/info.svg?raw";
import megaphoneSource from "./icons/apps/megaphone.svg?raw";
import roboticArmSource from "./icons/apps/robotic-arm.svg?raw";
import searchSource from "./icons/apps/search.svg?raw";
import steeringWheelSource from "./icons/apps/steering-wheel.svg?raw";
import tableSource from "./icons/apps/table.svg?raw";
import textSizeSource from "./icons/apps/text-size.svg?raw";
import underConstructionSource from "./icons/apps/under-construction.svg?raw";
import viewBoxes from "./navigation-icon-viewboxes.json" with { type: "json" };
import { NavigationIcon } from "./navigation-icons.js";

const sources = {
  ai: aiSource,
  analyze: analyzeSource,
  apps: appsSource,
  backlog: backlogSource,
  bookshelf: bookshelfSource,
  chemical: chemicalSource,
  "cloud-computing": cloudSource,
  cogwheel: cogwheelSource,
  "color-palette": paletteSource,
  communication: communicationSource,
  database: databaseSource,
  "down-right": downRightSource,
  folder: folderSource,
  "heart-rate": heartRateSource,
  helmet: helmetSource,
  home2: homeSource,
  info: infoSource,
  megaphone: megaphoneSource,
  "robotic-arm": roboticArmSource,
  search: searchSource,
  "steering-wheel": steeringWheelSource,
  table: tableSource,
  "text-size": textSizeSource,
  "under-construction": underConstructionSource,
};

const originalViewBoxes: Record<keyof typeof sources, string> = {
  ai: "0 0 24 24",
  analyze: "0 0 64 64",
  apps: "0 0 58 58",
  backlog: "0 0 497 497",
  bookshelf: "0 0 96 96",
  chemical: "0 0 512.004 512.004",
  "cloud-computing": "0 0 286.036 286.036",
  cogwheel: "0 0 512.207 512.207",
  "color-palette": "0 0 53 53",
  communication: "0 0 28 28",
  database: "0 0 512 512",
  "down-right": "0 0 512 512",
  folder: "0 0 497 497",
  "heart-rate": "0 0 128 128",
  helmet: "0 0 512 512",
  home2: "0 0 512 512",
  info: "0 0 24 24",
  megaphone: "0 0 468.293 468.293",
  "robotic-arm": "0 0 64 64",
  search: "0 0 512 512",
  "steering-wheel": "0 0 24 24",
  table: "0 0 512 512",
  "text-size": "0 0 512 512",
  "under-construction": "0 0 512 512",
};

// Original SHA-256, restoring only the pre-crop viewport and normalizing whitespace.
// Any change to paths, colors, transforms or other source attributes still fails.
it.each([
  ["app-ai", "ai", "cf3c105ed3971d57df1b46bf4e49923438dce37af8211bdded4262ab50410b2b"],
  ["app-analyze", "analyze", "5c1af58dcf5a4c84fadcc3672674592ecf1de653a757e69f243f0b9571f33879"],
  ["app-apps", "apps", "5118c212c6321477676fa7690442b316ad55d6da0947c7f808b5f6debafd00b7"],
  ["app-backlog", "backlog", "b01e7fbd44333e4dee1a2182d1f17bca9837fc56563222a115cf1b76ba90aecf"],
  [
    "app-bookshelf",
    "bookshelf",
    "1d5c4c558e014092ab8dab6a52f6e6c52ebd3425b5b1b5ec31c53440e75d87ce",
  ],
  ["app-chemical", "chemical", "8581778ad490731d5eb3553cd9d5fa97958bf6524568b3d3c89ad9e2113dca3b"],
  [
    "app-cloud-computing",
    "cloud-computing",
    "d1ab4c67cbf89aa897fba25fed4e59a9ea5527dc485c521793d87d877bace92b",
  ],
  ["app-cogwheel", "cogwheel", "123e7cd34af8718f7961b36b66703d3b7cd94dffe8bc34821d7922c46bc56676"],
  [
    "app-color-palette",
    "color-palette",
    "a6bbe67b4656be648d3004daaae1d181befa6eafde51d29e00425e950f74a2b4",
  ],
  [
    "app-communication",
    "communication",
    "2ed898978b4e068c8de63d8414c4f928845ff7fec3d2c949e4118f843ff3ec35",
  ],
  ["app-database", "database", "ad7d943c36e6f87b1bd835dc50e4edd352a552d1fd55b069dc221e64a02bee2f"],
  [
    "app-down-right",
    "down-right",
    "f9ad66c4e5636177a01d641cb2351cdc2009117a4f426ae2d030193af4d6adf0",
  ],
  ["app-folder", "folder", "f9daaf09c8c2cc87b430186aeacc326e195519fb2a5e181af821bb6733d6fcc6"],
  [
    "app-heart-rate",
    "heart-rate",
    "a9a62820544ac4e53aae18ac3b82fcf20a96e4d6a17aa20544f615ddb64289ea",
  ],
  ["app-home2", "home2", "74f740008c02e8fbe773777087d6fb18a0ea47e00f7f3b16146bc0976421bbf0"],
  ["app-helmet", "helmet", "eb8dc2e7d6ad2e86d6e884ad1645395c801db06185b07752ff3f83adbfcacd4d"],
  ["app-info", "info", "6bd430dd7a956dff52bf69207a23a2f7e2eaaafa53d8205e1b53324cca1e94e6"],
  [
    "app-megaphone",
    "megaphone",
    "2a518ec378f07ae92d739e2671ce33c6021376f071738c4b8c8ccd2729d39dbf",
  ],
  [
    "app-robotic-arm",
    "robotic-arm",
    "6c19bbea8667693e26b8291707b8e68f6fc701fa4c2b22e5d45109361e1d183e",
  ],
  [
    "app-steering-wheel",
    "steering-wheel",
    "6316b54776ce036ea5b077fe0eb8be13e07f80043e08c0cd4bbdd14d278a8a92",
  ],
  ["app-search", "search", "4dfe9399f6d1e0dd13834f388d8ce67d2f5178c36b29ad9eaa800c6112d35ec4"],
  ["app-table", "table", "ac677e39877a31d062ff390221951b0343fdd578eed8d196164a919c13fcbc27"],
  [
    "app-text-size",
    "text-size",
    "55bfc89feaf369600ad751381263a94711a4a16960b7fe72ebc28fd4b340afd0",
  ],
  [
    "app-under-construction",
    "under-construction",
    "53afc6d9dd9ba5925c2562dd65dc518a144741a8c603f777b459dbaac11bb639",
  ],
] as const)(
  "renders the original %s artwork locally and decoratively",
  async (name, file, hash) => {
    const html = renderToStaticMarkup(<NavigationIcon name={name} />);
    if (name === "app-text-size") {
      expect(html).toContain("<span");
      expect(html).toContain("mask-image:url(");
      expect(html).not.toContain("<img");
    } else {
      expect(html).toContain("<img");
      expect(html).toContain('alt="" aria-hidden="true" draggable="false"');
    }
    expect(html).toContain(`${file}.svg`);
    expect(html).toContain(`class="navigation-icon" data-icon="${name}"`);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toMatch(/<svg|<title|aria-label|tabindex|data:image/);
    expect(sources[file].match(/viewBox="([^"]+)"/)?.[1]).toBe(viewBoxes[name]);
    const original = sources[file].replace(
      /viewBox="[^"]+"/,
      `viewBox="${originalViewBoxes[file]}"`,
    );
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(original.replaceAll("\r\n", "\n").trim()),
    );
    expect(
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    ).toBe(hash);
  },
);

// SHA-256 of the original SVGs in the integrity-verified Phosphor 2.1.1 archive.
it.each([
  ["grid-nine", "a2ce684a854f339cada68550e5da7fa0e881d962a87f1e34d9a3e706d1647050"],
  ["app-window", "b528ad83ebe8025555a98bcf176afed223c3e9ae7592214c5dffa61bcf2564b0"],
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
    expect(html).toContain(`viewBox="${viewBoxes[name]}"`);
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
