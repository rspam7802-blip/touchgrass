# syntax=docker/dockerfile:1.7
#   docker build -f apps/web/Dockerfile -t touchgrass-web .
FROM public.ecr.aws/docker/library/node:22.21.1-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --filter @touchgrass/web... \
 && pnpm --filter @touchgrass/shared build \
 && pnpm --filter @touchgrass/web build \
 && pnpm --filter @touchgrass/web deploy --prod --legacy /out \
 && cp -r apps/web/.next /out/.next \
 && mkdir -p /out/public && cp -r apps/web/public/. /out/public/

FROM public.ecr.aws/docker/library/node:22.21.1-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /out ./
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "--port", "3000"]
