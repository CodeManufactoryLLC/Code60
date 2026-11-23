import { verify, writeManifest } from "./artifacts.mjs";

const tag = process.env.RELEASE_TAG;
const sha = process.env.RELEASE_SHA;
await writeManifest("release/build", tag, sha);
await verify("release/build", tag, sha);
process.stdout.write("Release package manifest and checksum verified.\n");
