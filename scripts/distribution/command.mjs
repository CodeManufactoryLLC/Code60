export async function runCommand(operation) {
  const controller = new AbortController();
  let interrupted;
  const stop = () => {
    interrupted = 130;
    controller.abort();
  };
  const terminate = () => {
    interrupted = 143;
    controller.abort();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", terminate);
  try {
    await operation(controller.signal);
  } catch (error) {
    console.error(error.message);
    process.exitCode = interrupted ?? 1;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", terminate);
    if (interrupted) process.exitCode = interrupted;
  }
}
