#!/bin/zsh
# Both harnesses, from anywhere.
set -u
here=${0:A:h}
for suite in core decode diffshape telemetry applayer; do
  print "== $suite"
  (cd "$here/$suite" && ./run.sh)
  code=$?
  # 3 is a suite saying it cannot run here, which is not the same as a failure.
  [[ $code -eq 0 || $code -eq 3 ]] || exit $code
done
