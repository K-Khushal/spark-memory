# The Deep fetch container (ADR-0010). Build from the repository root:
#   docker build -f apps/fetcher/Dockerfile .
# It needs yt-dlp, ffmpeg and Node (which is also the JavaScript runtime
# yt-dlp needs for YouTube). The audio of one job lives in a temporary
# directory that is removed when the job ends (src/tools.ts).
FROM node:22-slim

# yt-dlp breaks whenever a site changes, so the build takes the current
# release unless a version is pinned (--build-arg YT_DLP_VERSION=2026.11.12).
ARG YT_DLP_VERSION=latest
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg \
 && rm -rf /var/lib/apt/lists/* \
 && if [ "$YT_DLP_VERSION" = "latest" ]; then \
      url=https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux; \
    else \
      url=https://github.com/yt-dlp/yt-dlp/releases/download/$YT_DLP_VERSION/yt-dlp_linux; \
    fi \
 && curl -fsSL "$url" -o /usr/local/bin/yt-dlp \
 && chmod 0755 /usr/local/bin/yt-dlp \
 && apt-get purge -y curl && apt-get autoremove -y

RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/fetcher/package.json apps/fetcher/
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/deep-fetch/package.json packages/deep-fetch/
COPY packages/indexing/package.json packages/indexing/
RUN pnpm install --frozen-lockfile --filter @spark/fetcher...

COPY apps/fetcher apps/fetcher
COPY packages/config packages/config
COPY packages/core packages/core
COPY packages/deep-fetch packages/deep-fetch
COPY packages/indexing packages/indexing

# Cloud Run sets PORT. The token and the Gemini key come from Secret Manager.
ENV NODE_ENV=production
USER node
WORKDIR /app/apps/fetcher
CMD ["./node_modules/.bin/tsx", "src/main.ts"]
