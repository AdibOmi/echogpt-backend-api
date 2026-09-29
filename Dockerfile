# syntax=docker/dockerfile:1
#
# Multi-stage build:
#   build    → installs ALL deps, generates the Prisma client, compiles TypeScript
#   migrate  → one-off job: applies migrations + seeds (needs the Prisma CLI = dev dep)
#   runtime  → small final image: production deps + compiled JS only, runs as non-root

# ───────────────────────────── build ─────────────────────────────
FROM node:24-slim AS build
WORKDIR /app

# Copy dependency manifests first: this layer is cached until they change,
# so code edits don't trigger a full `npm ci`.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ───────────────────────────── migrate ─────────────────────────────
FROM build AS migrate
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed"]

# ───────────────────────────── runtime ─────────────────────────────
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
# --ignore-scripts skips `postinstall: prisma generate` (the client is already
# compiled into dist/). bcrypt ships prebuilt binaries, so no compiler needed.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/dist ./dist

# Never run as root inside the container.
USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
