# syntax=docker/dockerfile:1.7
# One image for the API, realtime gateway, worker and the one-off migration task (ECS chooses the command).
#   docker build -f apps/api/Dockerfile -t touchgrass-api .
FROM public.ecr.aws/docker/library/node:22.21.1-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter @touchgrass/api... \
 && pnpm --filter @touchgrass/shared build \
 && pnpm --filter @touchgrass/api build \
 && pnpm --filter @touchgrass/api deploy --prod --legacy /out

FROM public.ecr.aws/docker/library/node:22.21.1-bookworm-slim
ENV NODE_ENV=production
# RDS presents certificates from the Amazon RDS CA, which Node doesn't trust by default.
ADD --chmod=0644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem
WORKDIR /app
COPY --from=build /out ./
COPY --from=build /repo/apps/api/migrations ./migrations
USER node
EXPOSE 4000 4001
# Override per service: dist/realtime.js, dist/worker.js, dist/infra/database/migrate.cli.js
CMD ["node", "dist/main.js"]
