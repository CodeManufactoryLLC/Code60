import { pairingPolicySchema } from "../bridge/index.js";
import { fileCode, lockPrivateState, privateDirectory } from "../platform/index.js";
import { gatewayRoot, managementRequest } from "./server.js";
import { readGatewaySettings, writeGatewaySettings } from "./settings.js";

/** Local management only; a browser cannot change its own enrollment policy. */
export async function pairingControl(env: Readonly<NodeJS.ProcessEnv>, requirePairing?: boolean) {
  try {
    return pairingPolicySchema.parse(
      await managementRequest(
        env,
        "pairing",
        requirePairing === undefined ? undefined : { requirePairing },
      ),
    );
  } catch (error) {
    // Missing connection metadata is the only offline fallback. Unknown/live
    // ownership or a failed request never authorizes overwriting gateway state.
    if (fileCode(error) !== "ENOENT") throw error;
  }
  const root = gatewayRoot(env);
  if (requirePairing === undefined)
    return { requirePairing: (await readGatewaySettings(root))?.requirePairing ?? false };
  await privateDirectory(root);
  const release = await lockPrivateState(root);
  try {
    const previous = await readGatewaySettings(root);
    await writeGatewaySettings(root, { ...previous, requirePairing }, previous);
    return { requirePairing };
  } finally {
    await release();
  }
}
