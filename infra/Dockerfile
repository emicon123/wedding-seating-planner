# syntax=docker/dockerfile:1
# One image for SPA + API (ADR-001): node builds the SPA, go builds the static server,
# distroless runs both. Build context = repo root (see infra/compose.yml).
# All base images have a linux/arm64 variant (Raspberry Pi).

# --- Stage 1: React SPA (Vite, base /wesele/) --------------------------------
FROM node:22.23-alpine AS web
WORKDIR /src
COPY frontend-web/package.json frontend-web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY frontend-web/ ./
RUN npm run build

# --- Stage 2: Go server (static, CGO off) ------------------------------------
# Go >= go.mod's `go 1.27.1`; no toolchain download needed.
FROM golang:1.27.1-alpine AS server
ARG TARGETARCH
WORKDIR /src
COPY backend-go/go.mod backend-go/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY backend-go/ ./
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server
# distroless has no shell, so prepare the (empty) data dir here and copy it with the right owner.
RUN mkdir -p /out/data

# --- Stage 3: runtime --------------------------------------------------------
# Digest-pinned (rolling :nonroot tag); runs as uid/gid 65532.
FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab
COPY --from=server /out/server /app/server
COPY --from=web /src/dist /app/web
# Owned by nonroot so a fresh named volume mounted at /data inherits a writable directory.
COPY --from=server --chown=65532:65532 /out/data /data

ENV BASE_PATH=/wesele \
    PORT=8080 \
    DB_PATH=/data/stoliki.db \
    WEB_ROOT=/app/web

USER nonroot:nonroot
WORKDIR /app
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/app/server", "healthcheck"]
ENTRYPOINT ["/app/server"]
CMD ["serve"]
