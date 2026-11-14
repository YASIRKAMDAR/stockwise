#!/usr/bin/env bash
# Nightly encrypted logical backup -> off-site S3-compatible bucket.
# Requires in .env: BACKUP_PASSPHRASE (or BACKUP_AGE_RECIPIENT), BACKUP_BUCKET (s3://bucket/path), BACKUP_ACCESS_KEY,
# BACKUP_SECRET_KEY, BACKUP_ENDPOINT (e.g. https://<account>.r2.cloudflarestorage.com), BACKUP_RETENTION_DAYS.
# Set BACKUP_LOCAL_ONLY=true to skip upload (testing).
set -euo pipefail
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT=/backups/stockwise-$STAMP.dump
mkdir -p /backups
command -v gpg >/dev/null || { apt-get update -qq && apt-get install -y -qq gnupg >/dev/null; }

pg_dump --format=custom --no-owner --no-privileges -f "$OUT"
pg_restore --list "$OUT" >/dev/null   # sanity: archive is readable
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE required — backups are never stored unencrypted off-site}"
gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" --symmetric --cipher-algo AES256 -o "$OUT.gpg" "$OUT"
rm -f "$OUT"
sha256sum "$OUT.gpg" > "$OUT.gpg.sha256"

if [ "${BACKUP_LOCAL_ONLY:-false}" != "true" ]; then
  command -v aws >/dev/null || { apt-get install -y -qq awscli >/dev/null 2>&1 || (apt-get install -y -qq python3-pip >/dev/null && pip3 install -q --break-system-packages awscli); }
  export AWS_ACCESS_KEY_ID="$BACKUP_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$BACKUP_SECRET_KEY"
  aws s3 cp "$OUT.gpg" "$BACKUP_BUCKET/" ${BACKUP_ENDPOINT:+--endpoint-url "$BACKUP_ENDPOINT"}
  aws s3 cp "$OUT.gpg.sha256" "$BACKUP_BUCKET/" ${BACKUP_ENDPOINT:+--endpoint-url "$BACKUP_ENDPOINT"}
  echo "uploaded $(basename "$OUT.gpg")"
fi
# Local staging retention (off-site retention: configure a lifecycle rule on the bucket).
find /backups -name 'stockwise-*.dump.gpg*' -mtime +"${BACKUP_LOCAL_RETENTION_DAYS:-3}" -delete
date -u +%s > /backups/LAST_SUCCESS
echo "backup ok: $OUT.gpg"
