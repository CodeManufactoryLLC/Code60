FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git xvfb xauth fonts-dejavu-core fonts-liberation \
    libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 libasound2 \
    libxss1 libx11-xcb1 libdrm2 libxkbcommon0 libxdamage1 \
    libxfixes3 libxrandr2 libxcomposite1 libcups2 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /workspace && chown node:node /workspace

USER node
WORKDIR /workspace
ENV LANG=C.UTF-8
RUN git config --global user.name 'Code60 Container' \
    && git config --global user.email 'container@example.invalid'

# Cache Linux dependencies independently of source changes. Never copy host modules.
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && node node_modules/electron/install.js
# Download and verify the pinned offline embedding model in its own cached layer.
COPY --chown=node:node scripts/prepare-models.mjs scripts/
RUN node scripts/prepare-models.mjs
COPY --chown=node:node . .

ENTRYPOINT ["xvfb-run", "-a", "-s", "-screen 0 1280x1024x24", "npm", "run", "test:desktop", "--"]
CMD []
