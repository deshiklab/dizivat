#!/usr/bin/env bash
# Run a scripts/ suite and, when it fails, surface its tail as CI annotations.
#
# Why: the Actions log APIs redirect to hosts this repo's automation cannot always
# reach from outside (the run-summary trick in the workflows hit the same wall —
# `gh run view --log-failed` returns nothing while the job is still running, and
# the artifact/ log-download endpoints are not readable from restricted clients).
# Annotations, however, are plain text a step prints as it runs, and they are
# readable through the check-runs API — so the failing suite prints its own tail.
#
# Usage (from the workflow, working-directory: scripts):
#   bash .ci-run.sh e2e_r2.py            # or: bash .ci-run.sh contract.py --doc
set -uo pipefail

log="$(mktemp)"
python "$@" 2>&1 | tee "$log"
rc=${PIPESTATUS[0]}

if [ "$rc" -ne 0 ]; then
  echo "::error title=$1 failed (rc=$rc)::the tail of its output follows as further annotations"
  tail -c 8000 "$log" | tr -d '\r' | fold -s -w 650 | tail -10 | while IFS= read -r chunk; do
    [ -n "$chunk" ] && echo "::error title=$1 tail::${chunk}"
  done
fi
rm -f "$log"
exit "$rc"
