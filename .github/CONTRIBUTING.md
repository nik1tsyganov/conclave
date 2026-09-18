# Contributing

## Before anything

```bash
npm run check          # 883 tests and the release check
```

Both must pass on a clean checkout. CI runs the same command on Linux and macOS.

## The rules this repository holds itself to

- **Every failure becomes a permanent test.** A bug that was found once and fixed without a test
  will be found again. Pull requests that fix behaviour carry the test that would have caught it.
- **Policy values live in one place.** The dispatch matrix and the seat profiles are data, not
  code, and the runtime reads them rather than restating them. A second copy of a rule is a
  second rule as soon as one of them is edited.
- **The safe default is the loud one.** A missing record refuses; it does not allow. A check that
  could not run reports `NOT RUN` rather than passing quietly.
- **Seat fields change only through an owner-approved proposal.** Which model holds which seat is
  policy, not a preference.

## Running against real vendors

Nothing in `npm run check` calls a vendor. Driving an actual run needs the three CLIs signed in
on their own subscriptions, and `conclave_drive` refuses without an explicit `"spend": true`.
Never configure API-key billing for this runtime.
