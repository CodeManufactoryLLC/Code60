import { join } from "node:path";
import { type GatewaySettings, gatewaySettingsSchema } from "../bridge/index.js";
import { fileCode, readPrivateJson, writePrivateJson } from "../platform/index.js";

export async function readGatewaySettings(root: string): Promise<GatewaySettings | null> {
  const value = await readPrivateJson(join(root, "settings.json"), 16_384).catch((error) => {
    if (fileCode(error) !== "ENOENT") throw error;
    return null;
  });
  return value === null ? null : gatewaySettingsSchema.parse(value);
}

export async function writeGatewaySettings(
  root: string,
  next: GatewaySettings,
  previous: GatewaySettings | null,
) {
  await writePrivateJson(
    join(root, "settings.json"),
    gatewaySettingsSchema.parse(next),
    previous ?? undefined,
    16_384,
  );
}
