# The Deep fetch container (ADR-0010). Build from the repository root:
#   docker build -f apps/fetcher/Dockerfile .
# It needs yt-dlp, ffmpeg and Node (which is also the JavaScript runtime
# yt-dlp needs for YouTube). The audio of one job lives in a temporary
# directory that is removed when the job ends (src/tools.ts).
FROM node:22-slim

# yt-dlp is pinned to a release and checked twice: against the SHA-256 written
# here (so a swapped asset cannot pass) and against that release's own
# SHA2-256SUMS (so a typo in this file cannot). It breaks whenever a site
# changes: to update, take the new tag and its yt-dlp_linux line from
# https://github.com/yt-dlp/yt-dlp/releases/download/<tag>/SHA2-256SUMS and
# change both values below.
ARG YT_DLP_VERSION=2026.10.26
ARG YT_DLP_SHA256=767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg \
 && rm -rf /var/lib/apt/lists/* \
 && base=https://github.com/yt-dlp/yt-dlp/releases/download/$YT_DLP_VERSION \
 && cd /tmp \
 && curl -fsSL "$base/yt-dlp_linux" -o yt-dlp_linux \
 && curl -fsSL "$base/SHA2-256SUMS" -o SHA2-256SUMS \
 && echo "$YT_DLP_SHA256  yt-dlp_linux" | sha256sum -c - \
 && grep " yt-dlp_linux\$" SHA2-256SUMS | sha256sum -c - \
 && install -m 0755 yt-dlp_linux /usr/local/bin/yt-dlp \
 && rm -f yt-dlp_linux SHA2-256SUMS \
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
