import { gatewayControl, restoreSchedulerHandoff } from "./registration.js";
import { startGateway } from "./server.js";

if (Number(process.versions.node.split(".")[0]) !== 24) {
  process.stderr.write("Code60 requires Node 24.\n");
  process.exitCode = 1;
} else {
  startGateway({
    onStop: async () => {
      await gatewayControl(process.env, "stop", true);
    },
  })
    .then(async (gateway) => {
      if (gateway.scheduler)
        await restoreSchedulerHandoff(process.env, gateway.scheduler.request).catch(() => {
          process.stderr.write("Scheduler handoff needs recovery. Saved evidence is preserved.\n");
        });
      const stop = () => {
        void gateway.stop().then(
          () => {
            process.exitCode = 0;
          },
          () => {
            process.stderr.write("Gateway cleanup could not finish. Ownership was retained.\n");
            process.exitCode = 1;
          },
        );
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    })
    .catch(() => {
      process.stderr.write(
        "Code60 Gateway could not start. Check Node 24, private storage, assets and service ownership.\n",
      );
      process.exitCode = 1;
    });
}
