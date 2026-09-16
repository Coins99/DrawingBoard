import{defineConfig,devices}from"@playwright/test";

// The editor is served as static files. MediaPipe is stubbed inside the tests, so
// no model download or camera permission is needed; real-camera checks are manual.
export default defineConfig({
  testDir:"tests/e2e",
  timeout:30_000,
  expect:{timeout:5_000},
  fullyParallel:true,
  reporter:process.env.CI?[["github"],["html",{open:"never"}]]:[["list"]],
  use:{
    baseURL:"http://127.0.0.1:4173",
    trace:"retain-on-failure",
    permissions:[],
  },
  projects:[{name:"chromium",use:{...devices["Desktop Chrome"],viewport:{width:1280,height:800}}}],
  // The same dependency-free server the setup script uses, so tests and humans
  // exercise one code path.
  webServer:{
    command:"node scripts/serve.mjs --no-open --port 4173",
    url:"http://127.0.0.1:4173/DrawingBoard/index.html",
    reuseExistingServer:!process.env.CI,
    timeout:30_000,
  },
});
