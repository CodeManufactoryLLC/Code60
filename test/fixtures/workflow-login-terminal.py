"""Exercise the installed workflow login handoff in a disposable Linux PTY."""
import os
import pty
import select
import signal
import sys
import time

pid, terminal = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], [sys.argv[1], sys.argv[2], "workflows", "login"])

# Keep the authorization URL, state and account identifiers out of evidence.
output = bytearray()
end = time.monotonic() + 45
try:
    while time.monotonic() < end:
        if select.select([terminal], [], [], 0.5)[0]:
            output.extend(os.read(terminal, 8192))
        if b"auth.openai.com/" in output or b"localhost:1455" in output:
            os.write(terminal, b"\x03")
            break
    else:
        raise RuntimeError("Bundled Codex did not open the interactive login flow")
    for _ in range(200):
        finished, status = os.waitpid(pid, os.WNOHANG)
        if finished:
            pid = 0
            if os.waitstatus_to_exitcode(status) not in (130, -signal.SIGINT):
                raise RuntimeError("Login did not propagate interruption")
            break
        time.sleep(0.05)
    else:
        raise RuntimeError("Login did not stop after interruption")
finally:
    if pid:
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        os.waitpid(pid, 0)
    os.close(terminal)
