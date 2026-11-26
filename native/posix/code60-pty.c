/* First-party POSIX PTY supervisor (macOS & Linux). Zero ABI-dependent Node addons.
 *
 * Usage: code60-pty <cols> <rows> <shell> [args...]
 *   fd 0: raw input bytes from host -> PTY master
 *   fd 1: raw output bytes from PTY master -> host
 *   fd 2: helper fatal diagnostics only
 *   fd 3: bidirectional control channel (newline-delimited commands/JSON events)
 */
#ifdef __linux__
#define _DEFAULT_SOURCE
#endif

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <termios.h>
#include <time.h>
#include <unistd.h>

#ifdef __APPLE__
#include <util.h>
#else
#include <pty.h>
#endif

#define CONTROL_FD 3
#define MAX_CONTROL_LINE 1024
#define MAX_PENDING_INPUT (64 * 1024)

static int sig_pipe[2] = {-1, -1};

static void on_sigchld(int sig) {
  (void)sig;
  int saved = errno;
  if (sig_pipe[1] >= 0) {
    char byte = 1;
    ssize_t ignored = write(sig_pipe[1], &byte, 1);
    (void)ignored;
  }
  errno = saved;
}

static int64_t monotonic_ms(void) {
  struct timespec ts;
  if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0) return 0;
  return (int64_t)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

static int set_nonblock(int fd) {
  int flags = fcntl(fd, F_GETFL, 0);
  if (flags < 0) return -1;
  return fcntl(fd, F_SETFL, flags | O_NONBLOCK);
}

static int set_cloexec(int fd) {
  int flags = fcntl(fd, F_GETFD, 0);
  if (flags < 0) return -1;
  return fcntl(fd, F_SETFD, flags | FD_CLOEXEC);
}

static bool write_all_fd(int fd, const char *buf, size_t len) {
  size_t off = 0;
  while (off < len) {
    ssize_t n = write(fd, buf + off, len - off);
    if (n > 0) {
      off += (size_t)n;
      continue;
    }
    if (n < 0 && errno == EINTR) continue;
    if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
      struct pollfd pfd = {.fd = fd, .events = POLLOUT, .revents = 0};
      int r = poll(&pfd, 1, 1000);
      if (r <= 0) return false;
      continue;
    }
    return false;
  }
  return true;
}

static bool parse_dim(const char *s, int min_v, int max_v, unsigned short *out) {
  if (!s || !*s) return false;
  char *end = NULL;
  errno = 0;
  long v = strtol(s, &end, 10);
  if (errno != 0 || !end || *end != '\0' || v < min_v || v > max_v) return false;
  *out = (unsigned short)v;
  return true;
}

static const char *signal_name(int sig) {
  switch (sig) {
    case SIGHUP: return "SIGHUP";
    case SIGINT: return "SIGINT";
    case SIGQUIT: return "SIGQUIT";
    case SIGKILL: return "SIGKILL";
    case SIGTERM: return "SIGTERM";
    case SIGPIPE: return "SIGPIPE";
    case SIGABRT: return "SIGABRT";
    case SIGSEGV: return "SIGSEGV";
    default: return NULL;
  }
}

static void handle_control_line(const char *line, int master_fd, pid_t child_pid,
                                bool *stopping, int64_t *kill_deadline_ms) {
  if (strcmp(line, "stop") == 0) {
    if (!*stopping) {
      *stopping = true;
      *kill_deadline_ms = monotonic_ms() + 1500;
      (void)kill(-child_pid, SIGHUP);
      (void)kill(-child_pid, SIGTERM);
    }
    return;
  }
  if (strncmp(line, "resize ", 7) == 0) {
    const char *rest = line + 7;
    const char *space = strchr(rest, ' ');
    if (!space) return;
    char cols_buf[16];
    size_t cols_len = (size_t)(space - rest);
    if (cols_len == 0 || cols_len >= sizeof(cols_buf)) return;
    memcpy(cols_buf, rest, cols_len);
    cols_buf[cols_len] = '\0';
    unsigned short cols = 0, rows = 0;
    if (!parse_dim(cols_buf, 2, 500, &cols) || !parse_dim(space + 1, 1, 200, &rows)) return;
    struct winsize ws;
    memset(&ws, 0, sizeof(ws));
    ws.ws_col = cols;
    ws.ws_row = rows;
    (void)ioctl(master_fd, TIOCSWINSZ, &ws);
  }
}

int main(int argc, char **argv) {
  if (argc < 4) {
    fprintf(stderr, "Code60 POSIX PTY helper: missing arguments\n");
    return 1;
  }
  unsigned short cols = 0, rows = 0;
  if (!parse_dim(argv[1], 2, 500, &cols) || !parse_dim(argv[2], 1, 200, &rows)) {
    fprintf(stderr, "Code60 POSIX PTY helper: invalid terminal dimensions\n");
    return 1;
  }
  if (argv[3][0] != '/') {
    fprintf(stderr, "Code60 POSIX PTY helper: shell must be an absolute path\n");
    return 1;
  }
  if (fcntl(CONTROL_FD, F_GETFD) < 0) {
    fprintf(stderr, "Code60 POSIX PTY helper: missing control channel\n");
    return 1;
  }

  if (pipe(sig_pipe) != 0) {
    fprintf(stderr, "Code60 POSIX PTY helper: cannot create signal pipe\n");
    return 1;
  }
  (void)set_nonblock(sig_pipe[0]);
  (void)set_nonblock(sig_pipe[1]);
  (void)set_cloexec(sig_pipe[0]);
  (void)set_cloexec(sig_pipe[1]);

  signal(SIGPIPE, SIG_IGN);
  struct sigaction sa;
  memset(&sa, 0, sizeof(sa));
  sa.sa_handler = on_sigchld;
  sa.sa_flags = SA_RESTART | SA_NOCLDSTOP;
  if (sigaction(SIGCHLD, &sa, NULL) != 0) {
    fprintf(stderr, "Code60 POSIX PTY helper: cannot install SIGCHLD handler\n");
    return 1;
  }

  struct winsize ws;
  memset(&ws, 0, sizeof(ws));
  ws.ws_col = cols;
  ws.ws_row = rows;

  int master_fd = -1, slave_fd = -1;
  if (openpty(&master_fd, &slave_fd, NULL, NULL, &ws) != 0) {
    fprintf(stderr, "Code60 POSIX PTY helper: openpty failed (%s)\n", strerror(errno));
    return 1;
  }

  pid_t child_pid = fork();
  if (child_pid < 0) {
    fprintf(stderr, "Code60 POSIX PTY helper: fork failed (%s)\n", strerror(errno));
    close(master_fd);
    close(slave_fd);
    return 1;
  }

  if (child_pid == 0) {
    close(master_fd);
    close(sig_pipe[0]);
    close(sig_pipe[1]);
    close(CONTROL_FD);

    signal(SIGCHLD, SIG_DFL);
    signal(SIGPIPE, SIG_DFL);
    signal(SIGINT, SIG_DFL);
    signal(SIGTERM, SIG_DFL);
    signal(SIGHUP, SIG_DFL);
    signal(SIGQUIT, SIG_DFL);
    signal(SIGTSTP, SIG_DFL);
    signal(SIGTTIN, SIG_DFL);
    signal(SIGTTOU, SIG_DFL);

    if (setsid() < 0) _exit(126);
    if (ioctl(slave_fd, TIOCSCTTY, 0) < 0) _exit(126);
    if (dup2(slave_fd, STDIN_FILENO) < 0) _exit(126);
    if (dup2(slave_fd, STDOUT_FILENO) < 0) _exit(126);
    if (dup2(slave_fd, STDERR_FILENO) < 0) _exit(126);
    if (slave_fd > STDERR_FILENO) close(slave_fd);

    for (int fd = 3; fd < 64; ++fd) close(fd);

    execv(argv[3], &argv[3]);
    _exit(127);
  }

  close(slave_fd);
  (void)set_nonblock(master_fd);
  (void)set_nonblock(STDIN_FILENO);
  (void)set_nonblock(CONTROL_FD);

  char ready_msg[128];
  int ready_len = snprintf(ready_msg, sizeof(ready_msg),
                           "{\"version\":1,\"pid\":%lld}\n", (long long)child_pid);
  if (ready_len <= 0 || !write_all_fd(CONTROL_FD, ready_msg, (size_t)ready_len)) {
    (void)kill(-child_pid, SIGKILL);
    (void)waitpid(child_pid, NULL, 0);
    close(master_fd);
    return 1;
  }

  bool stdin_open = true;
  bool master_open = true;
  bool control_open = true;
  bool stopping = false;
  bool killed = false;
  bool reaped = false;
  int child_status = 0;
  int64_t kill_deadline_ms = 0;

  char pending_in[MAX_PENDING_INPUT];
  size_t pending_in_len = 0;
  char ctrl_buf[MAX_CONTROL_LINE];
  size_t ctrl_len = 0;
  char io_buf[16384];

  while (!reaped) {
    struct pollfd pfds[4];
    pfds[0].fd = (stdin_open && pending_in_len < MAX_PENDING_INPUT) ? STDIN_FILENO : -1;
    pfds[0].events = POLLIN;
    pfds[0].revents = 0;

    pfds[1].fd = master_open ? master_fd : -1;
    pfds[1].events = (short)(POLLIN | (pending_in_len > 0 ? POLLOUT : 0));
    pfds[1].revents = 0;

    pfds[2].fd = control_open ? CONTROL_FD : -1;
    pfds[2].events = POLLIN;
    pfds[2].revents = 0;

    pfds[3].fd = sig_pipe[0];
    pfds[3].events = POLLIN;
    pfds[3].revents = 0;

    int timeout_ms = -1;
    if (stopping && !killed) {
      int64_t rem = kill_deadline_ms - monotonic_ms();
      timeout_ms = rem > 0 ? (int)rem : 0;
    }

    int ready = poll(pfds, 4, timeout_ms);
    if (ready < 0) {
      if (errno == EINTR) continue;
      break;
    }

    if (stopping && !killed && monotonic_ms() >= kill_deadline_ms) {
      killed = true;
      (void)kill(-child_pid, SIGKILL);
    }

    /* 1. Flush queued host input to PTY master */
    if (master_open && pending_in_len > 0 && (pfds[1].revents & POLLOUT)) {
      ssize_t written = write(master_fd, pending_in, pending_in_len);
      if (written > 0) {
        size_t n = (size_t)written;
        if (n < pending_in_len) memmove(pending_in, pending_in + n, pending_in_len - n);
        pending_in_len -= n;
      } else if (written < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) {
        master_open = false;
      }
    }

    /* 2. Read PTY master output -> host stdout */
    if (master_open && (pfds[1].revents & (POLLIN | POLLHUP | POLLERR))) {
      ssize_t n = read(master_fd, io_buf, sizeof(io_buf));
      if (n > 0) {
        if (!write_all_fd(STDOUT_FILENO, io_buf, (size_t)n)) {
          if (!stopping) {
            stopping = true;
            kill_deadline_ms = monotonic_ms() + 1500;
            (void)kill(-child_pid, SIGHUP);
            (void)kill(-child_pid, SIGTERM);
          }
        }
      } else if (n == 0 || (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR)) {
        master_open = false;
      }
    }

    /* 3. Read host stdin -> pending input buffer */
    if (stdin_open && (pfds[0].revents & (POLLIN | POLLHUP | POLLERR))) {
      size_t space = MAX_PENDING_INPUT - pending_in_len;
      if (space > 0) {
        ssize_t n = read(STDIN_FILENO, pending_in + pending_in_len, space);
        if (n > 0) {
          pending_in_len += (size_t)n;
        } else if (n == 0 || (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR)) {
          stdin_open = false;
        }
      }
    }

    /* 4. Read control commands from fd 3 */
    if (control_open && (pfds[2].revents & (POLLIN | POLLHUP | POLLERR))) {
      char chunk[256];
      ssize_t n = read(CONTROL_FD, chunk, sizeof(chunk));
      if (n > 0) {
        for (ssize_t i = 0; i < n; ++i) {
          if (chunk[i] == '\n') {
            ctrl_buf[ctrl_len] = '\0';
            handle_control_line(ctrl_buf, master_fd, child_pid, &stopping, &kill_deadline_ms);
            ctrl_len = 0;
          } else if (chunk[i] != '\r' && ctrl_len + 1 < sizeof(ctrl_buf)) {
            ctrl_buf[ctrl_len++] = chunk[i];
          }
        }
      } else if (n == 0 || (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR)) {
        control_open = false;
        if (!stopping) {
          stopping = true;
          kill_deadline_ms = monotonic_ms() + 1500;
          (void)kill(-child_pid, SIGHUP);
          (void)kill(-child_pid, SIGTERM);
        }
      }
    }

    /* 5. Reap exited shell child */
    if (pfds[3].revents & POLLIN) {
      char drain[64];
      while (read(sig_pipe[0], drain, sizeof(drain)) > 0) {}
    }
    pid_t w = waitpid(child_pid, &child_status, WNOHANG);
    if (w == child_pid) {
      reaped = true;
    } else if (w < 0 && errno == ECHILD) {
      reaped = true;
    }
  }

  /* Drain any remaining buffered PTY output before reporting exit */
  if (master_open) {
    size_t drained = 0;
    while (drained < 256 * 1024) {
      ssize_t n = read(master_fd, io_buf, sizeof(io_buf));
      if (n <= 0) break;
      if (!write_all_fd(STDOUT_FILENO, io_buf, (size_t)n)) break;
      drained += (size_t)n;
    }
  }

  /* Ensure any remaining children in the session process group are terminated */
  (void)kill(-child_pid, SIGHUP);
  (void)kill(-child_pid, SIGKILL);

  if (control_open) {
    char exit_msg[128];
    int exit_len = 0;
    if (WIFEXITED(child_status)) {
      exit_len = snprintf(exit_msg, sizeof(exit_msg),
                          "{\"stopped\":true,\"exit\":%d,\"signal\":null}\n",
                          WEXITSTATUS(child_status));
    } else if (WIFSIGNALED(child_status)) {
      const char *name = signal_name(WTERMSIG(child_status));
      if (name) {
        exit_len = snprintf(exit_msg, sizeof(exit_msg),
                            "{\"stopped\":true,\"exit\":null,\"signal\":\"%s\"}\n", name);
      } else {
        exit_len = snprintf(exit_msg, sizeof(exit_msg),
                            "{\"stopped\":true,\"exit\":null,\"signal\":\"SIG%d\"}\n",
                            WTERMSIG(child_status));
      }
    } else {
      exit_len = snprintf(exit_msg, sizeof(exit_msg),
                          "{\"stopped\":true,\"exit\":null,\"signal\":null}\n");
    }
    if (exit_len > 0) (void)write_all_fd(CONTROL_FD, exit_msg, (size_t)exit_len);
  }

  close(master_fd);
  close(sig_pipe[0]);
  close(sig_pipe[1]);
  return 0;
}
