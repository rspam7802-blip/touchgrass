#!/usr/bin/env bash
# Runs every Maestro flow even when one fails, then exits non-zero listing the ones that did (D-190).
# Each flow writes a JUnit report to /tmp/maestro-<flow>.xml.
set -u
maestro="${MAESTRO:-$HOME/.maestro/bin/maestro}"
failed=""
for f in apps/mobile/.maestro/*.yaml; do
  name="$(basename "$f" .yaml)"
  extra=()
  # Sign-up needs a number nobody has used yet.
  case "$name" in 01-signup*) extra=(-e "PHONE=7$(date +%H%M%S)123") ;; esac
  echo "::group::$name"
  # Close any system popup (e.g. an emulator "isn't responding" dialog) left over from the last flow.
  adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1 || true
  if ! "$maestro" test "${extra[@]}" --format junit --output "/tmp/maestro-$name.xml" "$f"; then
    failed="$failed $name"
  fi
  echo "::endgroup::"
done
if [ -n "$failed" ]; then
  echo "::error::Maestro flows failed:$failed"
  exit 1
fi
echo "All Maestro flows passed."
