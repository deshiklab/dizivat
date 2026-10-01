#!/usr/bin/env bash
# Runs every browser/API suite in CI order against BASE_URL (fresh server expected). Summary → stdout.
cd "$(dirname "$0")"
SUITES=${SUITES:-"capture e2e e2e_s2 contract e2e_s3 e2e_s4 e2e_r2 e2e_r3 e2e_r4 e2e_kb e2e_m43 e2e_pdf e2e_r6 e2e_r62 a11y"}
for s in $SUITES; do
  start=$(date +%s)
  timeout 1500 python3 "$s.py" > "/tmp/suite-$s.log" 2>&1; rc=$?
  echo "$s rc=$rc $(( $(date +%s) - start ))s :: $(grep -E 'passed|failed|PASS:|violations|OK' /tmp/suite-$s.log | tail -1 | cut -c1-120)"
done
echo ALLDONE
