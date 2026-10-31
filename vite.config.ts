import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Local only: bind to loopback, fixed port, no LAN exposure.
// Vite's default allowedHosts check rejects requests whose Host header is not localhost.
export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5317, strictPort: true },
  preview: { host: "127.0.0.1", port: 5318, strictPort: true },
  test: {
    environment: "node",
    include: ["week/**/*.test.ts", "plan/**/*.test.ts", "store/**/*.test.ts", "ui/**/*.test.ts", "sources/**/*.test.ts", "fixtures/**/*.test.ts", "config/**/*.test.ts", "secrets/**/*.test.ts", "server/**/*.test.ts", "actions/**/*.test.ts"],
  },
});
