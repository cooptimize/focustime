import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { testWorkers, thisMachine } from "./test/workers.ts";

// HK-5: the test run's worker count from this machine (test/workers.ts), said once at the start of a run.
const workers = testWorkers(thisMachine());
if (process.env.VITEST && !process.env.VITEST_WORKER_ID && !process.env.FOCUSTIME_TEST_WORKERS_SAID) (process.env.FOCUSTIME_TEST_WORKERS_SAID = "1"), process.stderr.write(`test workers: ${workers} (test/workers.ts; FOCUSTIME_TEST_WORKERS sets it)\n`);

// Local only: bind to loopback, fixed port, no LAN exposure.
// Vite's default allowedHosts check rejects requests whose Host header is not localhost.
export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5317, strictPort: true },
  preview: { host: "127.0.0.1", port: 5318, strictPort: true },
  test: {
    environment: "node",
    maxWorkers: workers,
    setupFiles: ["test/no-promise-expect.ts"],
    globalSetup: ["test/tmp-dir.ts", "test/e2e-build.ts"],
    include: ["week/**/*.test.ts", "plan/**/*.test.ts", "store/**/*.test.ts", "ui/**/*.test.ts", "sources/**/*.test.ts", "fixtures/**/*.test.ts", "config/**/*.test.ts", "host/**/*.test.ts", "server/**/*.test.ts", "actions/**/*.test.ts", "links/**/*.test.ts", "log/**/*.test.ts", "ai/**/*.test.ts", "assistant/**/*.test.ts", "e2e/**/*.test.ts", "test/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
