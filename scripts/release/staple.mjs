import { setTimeout } from "node:timers/promises";
import { run } from "./common.mjs";

export async function staple(path, execute = run, wait = setTimeout) {
  for (let attempt = 1; ; attempt++) {
    try {
      execute("/usr/bin/xcrun", ["stapler", "staple", path]);
      return;
    } catch (error) {
      // Apple's ticket delivery can briefly disconnect after accepting a submission.
      // Retry only its service-unavailable result; never ignore a final failure.
      if (error.status !== 68 || attempt === 3) throw error;
      console.warn(`Apple ticket delivery unavailable; retrying stapling (${attempt}/2).`);
      await wait(attempt * 15_000);
    }
  }
}
