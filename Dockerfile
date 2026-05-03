# syntax=docker/dockerfile:1.7
# Multi-stage Nuxt build → Node-server runtime.
# Final image runs `node .output/server/index.mjs` on port 3000.

FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat \
 && corepack enable \
 && corepack prepare pnpm@10.33.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
RUN addgroup -g 1001 -S nodejs \
 && adduser  -u 1001 -S nuxt -G nodejs
COPY --from=builder --chown=nuxt:nodejs /app/.output ./.output

USER nuxt
ENV NODE_ENV=production \
    NITRO_HOST=0.0.0.0 \
    NITRO_PORT=3000
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
