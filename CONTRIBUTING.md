# Contributing to DrawingBoard

Use Node.js 20.11 or newer. The editor runs with `npm start` without installing packages. For development:

```sh
npm ci
npx playwright install chromium
npm test
npm run test:e2e
npm run evaluate
```

On Windows PowerShell, use `npm.cmd` and `npx.cmd` if script execution policy blocks the commands.

## Pull requests

1. Branch from the latest `main` and keep the change focused.
2. Use the shared document commands for both pointer and gesture editing.
3. Add a regression case for behavior fixes and run the relevant suites above.
4. For visual changes, regenerate `img/demo.png` with `node scripts/screenshot.mjs`.
5. Describe the resulting behavior and validation in a pull request against `main`.

Start with [architecture](docs/architecture.md). Recognition changes should include the synthetic evaluation results and preserve the distinction between replay coverage and real-camera acceptance.

## Bug reports

Include your OS, browser, reproduction steps, expected result and actual result. A small synthetic JSON diagram or a screenshot helps with editor bugs.

For gesture reports, use [the manual camera checklist](docs/manual-camera-checklist.md). Include camera/device, lighting and distance, and indicate whether the problem occurs with mouse input too. Do not include private diagrams or recordings without reviewing them first.
