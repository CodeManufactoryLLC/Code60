import { startGateway } from "../dist/gateway/index.js";
import { developmentPort } from "./dev-ports.mjs";

const developmentPortNumber = developmentPort(
  process.env.CODE60_DEV_GATEWAY_PORT,
  "CODE60_DEV_GATEWAY_PORT",
);
const gateway = await startGateway({
  developmentAssets: process.env.CODE60_DEV_ASSETS,
  ...(developmentPortNumber === undefined ? {} : { developmentPort: developmentPortNumber }),
});
process.stdout.write(`Development Code60: ${gateway.origin}\n`);
if (gateway.requirePairing) process.stdout.write(`Pairing code: ${gateway.proof()}\n`);
const stop = () =>
  void gateway.stop().then(
    () => {
      process.exitCode = 0;
    },
    () => {
      process.stderr.write("Development Gateway cleanup failed.\n");
      process.exitCode = 1;
    },
  );
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
