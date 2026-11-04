#!/usr/bin/env bash
# Daily database backup for the test server; keeps the last 7. Add to cron:
#   0 3 * * * /home/ubuntu/touchgrass/infra/staging/backup.sh >> /home/ubuntu/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
STAMP="$(date -u +%Y%m%d-%H%M)"
docker compose exec -T postgres pg_dump -U touchgrass -d touchgrass --format=custom > "backups/touchgrass-${STAMP}.dump"
ls -1t backups/touchgrass-*.dump | tail -n +8 | xargs -r rm --
echo "backup ok: backups/touchgrass-${STAMP}.dump"
