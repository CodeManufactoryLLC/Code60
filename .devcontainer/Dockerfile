# Node 24.22.0, Debian 12, linux/amd64; verified against the Docker registry.
FROM node:24.22.0-bookworm-slim@sha256:a8efdaa8f2458a83ad61c9b8e957c94c2312a9e60604d5b9b093cf89ad9f5984

ARG CODE60_WORKSPACE_ID
LABEL com.code60.devcontainer="${CODE60_WORKSPACE_ID}"

# Chromium dependencies match Playwright's Debian 12 support. Chromium itself
# is installed explicitly, from the project's locked Playwright version.
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates fish gcc git libc6-dev openssh-client tini zsh \
    fonts-freefont-ttf fonts-ipafont-gothic fonts-liberation fonts-noto-color-emoji \
    fonts-tlwg-loma-otf fonts-unifont fonts-wqy-zenhei xfonts-scalable \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcairo2 \
    libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 libnspr4 libnss3 \
    libgomp1 libpango-1.0-0 libwayland-client0 libx11-6 libxcb1 libxcomposite1 \
    libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
    && rm -rf /var/lib/apt/lists/* \
    && printf '%s\n' \
      'case "$TERM" in' \
      '  xterm-color|*-256color)' \
      '    PS1='\''\[\033[01;32m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ '\''' \
      '    if [ -x /usr/bin/dircolors ]; then' \
      '      eval "$(dircolors -b)"' \
      '      alias ls='\''ls --color=auto'\''' \
      '      alias grep='\''grep --color=auto'\''' \
      '    fi' \
      '    ;;' \
      'esac' >> /etc/bash.bashrc

COPY init-volumes.mjs /usr/local/lib/code60/init-volumes.mjs
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sleep", "infinity"]
