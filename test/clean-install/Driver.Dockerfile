FROM node:24.22.0-bookworm-slim@sha256:a8efdaa8f2458a83ad61c9b8e957c94c2312a9e60604d5b9b093cf89ad9f5984
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /driver
COPY driver-package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/browsers
RUN node node_modules/playwright/cli.js install --with-deps chromium
COPY driver/ ./
ARG ACCEPTANCE_RUN
LABEL com.code60.acceptance.run="${ACCEPTANCE_RUN}"
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "node_modules/@playwright/test/cli.js", "test", "--config", "installed.config.ts"]
