import { createConnection } from "node:net";
import { developmentPort } from "./dev-ports.mjs";

const port = developmentPort(process.argv[2], "tunnel port");
if (port === undefined) throw new Error("Supply a tunnel port.");
const socket = createConnection({ host: "127.0.0.1", port });
const close = () => {
  socket.destroy();
  process.stdin.destroy();
};
socket.once("error", () => {
  process.exitCode = 1;
  close();
});
socket.once("close", close);
process.stdin.once("error", close);
process.stdout.once("error", close);
process.once("SIGTERM", close);
process.once("SIGINT", close);
process.stdin.pipe(socket);
socket.pipe(process.stdout);
