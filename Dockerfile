# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base

ARG PNPM_VERSION=10.12.4
ENV PNPM_HOME=/pnpm
ENV COREPACK_HOME=/corepack
ENV PATH=${PNPM_HOME}:${PATH}
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

RUN mkdir -p ${COREPACK_HOME} \
  && corepack enable \
  && corepack prepare pnpm@${PNPM_VERSION} --activate \
  && chown -R node:node ${COREPACK_HOME}

FROM base AS deps

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_GIT_COMMIT=unknown
ENV NEXT_PUBLIC_GIT_COMMIT=${NEXT_PUBLIC_GIT_COMMIT}
RUN pnpm run build

FROM base AS maintenance

ENV NODE_ENV=production

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json pnpm-lock.yaml tsconfig.json ./
COPY --chown=node:node drizzle ./drizzle
COPY --chown=node:node lib ./lib
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node types ./types

USER node

CMD ["pnpm", "run", "db:migrate"]

FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3232
ENV HOSTNAME=0.0.0.0
WORKDIR /app

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/scripts/inject-peer-address.cjs ./scripts/inject-peer-address.cjs

USER nextjs
EXPOSE 3232

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3232) + '/health/live').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "--require", "./scripts/inject-peer-address.cjs", "server.js"]
