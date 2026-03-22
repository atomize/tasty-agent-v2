FROM node:22-slim AS build

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/monitor/package.json packages/monitor/
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/claude-agent/package.json packages/claude-agent/

RUN pnpm install --frozen-lockfile

COPY packages/shared/ packages/shared/
COPY packages/monitor/ packages/monitor/
COPY packages/dashboard/ packages/dashboard/
COPY packages/claude-agent/ packages/claude-agent/
COPY tsconfig.base.json ./

RUN pnpm --filter @tastytrade-monitor/shared build \
 && pnpm --filter @tastytrade-monitor/claude-agent build \
 && pnpm --filter @tastytrade-monitor/monitor build \
 && pnpm --filter @tastytrade-monitor/dashboard build

# -------------------------------------------------------------------
FROM node:22-slim AS runtime

RUN npm install -g @mariozechner/pi-coding-agent && npm cache clean --force

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/monitor/dist ./packages/monitor/dist
COPY --from=build /app/packages/monitor/package.json ./packages/monitor/
COPY --from=build /app/packages/monitor/node_modules ./packages/monitor/node_modules
COPY --from=build /app/packages/dashboard/dist ./packages/dashboard/dist
COPY --from=build /app/packages/dashboard/package.json ./packages/dashboard/

COPY packages/pi-agent/ ./packages/pi-agent/
RUN cd /app/packages/pi-agent && npm install --production --ignore-scripts

COPY --from=build /app/packages/claude-agent/dist ./packages/claude-agent/dist
COPY --from=build /app/packages/claude-agent/package.json ./packages/claude-agent/
COPY --from=build /app/packages/claude-agent/node_modules ./packages/claude-agent/node_modules
COPY packages/claude-agent/.claude/ ./packages/claude-agent/.claude/

COPY docker/entrypoint-monitor.sh docker/entrypoint-pi.sh docker/entrypoint-agent.sh /app/docker/
RUN chmod +x /app/docker/*.sh

EXPOSE 3001 10000

CMD ["/app/docker/entrypoint-monitor.sh"]
