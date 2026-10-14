#!/usr/bin/env bash
# Generate a synthetic long test clip for the headed memory/scrub run.
# Output is NOT committed: apps/web/public/*.mp4 is gitignored.
#
#   ./scripts/make-test-media.sh [seconds, default 600] [output, default apps/web/public/test-long.mp4]
#
# 10 min of 720p30 testsrc + 440 Hz sine, x264 veryfast/crf 28: roughly
# 100-200 MB. Short on disk or time? Pass 300 for a 5-minute clip.
set -euo pipefail

SECONDS="${1:-600}"
OUT="${2:-apps/web/public/test-long.mp4}"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "make-test-media: ffmpeg not found" >&2
  exit 1
fi

case "$OUT" in
  *.mp4) ;;
  *) echo "make-test-media: refusing non-.mp4 output $OUT" >&2; exit 1 ;;
esac

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc=duration=${SECONDS}:size=1280x720:rate=30" \
  -f lavfi -i "sine=frequency=440:duration=${SECONDS}" \
  -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p \
  -c:a aac -b:a 128k -shortest \
  "$OUT"

echo "wrote $OUT ($(du -h "$OUT" | cut -f1))"
