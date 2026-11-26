# Node 24.22.0, Debian 12, linux/amd64; pinned digest matches .devcontainer/Dockerfile.
FROM --platform=linux/amd64 node:24.22.0-bookworm-slim@sha256:a8efdaa8f2458a83ad61c9b8e957c94c2312a9e60604d5b9b093cf89ad9f5984

ARG CODE60_VERSION="0.0.0"
ARG CODE60_REVISION="unknown"
ARG CODE60_CREATED=""

LABEL org.opencontainers.image.title="Code60" \
      org.opencontainers.image.description="Local browser application for orchestrating coding agents" \
      org.opencontainers.image.url="https://github.com/CodeManufactoryLLC/code60" \
      org.opencontainers.image.source="https://github.com/CodeManufactoryLLC/code60" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.vendor="Code Manufactory LLC" \
      org.opencontainers.image.version="${CODE60_VERSION}" \
      org.opencontainers.image.revision="${CODE60_REVISION}" \
      org.opencontainers.image.created="${CODE60_CREATED}"

# Debian glibc + libgomp1 are required for bundled ONNX CPU embeddings; Alpine/musl is unsupported.
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates git libgomp1 openssh-client tini \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/code60 /workspaces /home/node/.local/bin \
    && chown -R node:node /workspaces /home/node \
    && chmod 0700 /home/node \
    && chmod 0755 /workspaces

# Verified linux-x64 release payload staged by scripts/package-docker.mjs (read-only at runtime).
COPY --chown=root:root payload/ /opt/code60/

RUN chmod 0755 /opt/code60/dist/platform/code60-pty \
    && printf '#!/bin/sh\nexec node /opt/code60/dist/gateway/container.js "$@"\n' > /usr/local/bin/code60-gateway \
    && printf '#!/bin/sh\nexec node /opt/code60/dist/management/main.js "$@"\n' > /usr/local/bin/code60 \
    && chmod 0755 /usr/local/bin/code60-gateway /usr/local/bin/code60

ENV HOME=/home/node \
    LANG=C.UTF-8 \
    CODE60_PORT=6060 \
    CODE60_BIND=0.0.0.0 \
    CODE60_WORKSPACE_ROOTS=/workspaces \
    NPM_CONFIG_PREFIX=/home/node/.local \
    PATH=/home/node/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

USER node
WORKDIR /workspaces
EXPOSE 6060

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["code60-gateway", "health"]

ENTRYPOINT ["/usr/bin/tini", "--", "code60-gateway"]
CMD ["serve"]
