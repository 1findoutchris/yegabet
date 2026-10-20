import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The web app (plan 11 lite): built into web/dist and served by the API
 * service itself at "/", so the session cookie is same-origin. In dev, Vite
 * proxies API calls to a local API on :3000.
 */
const api = ["/health", "/auth", "/me", "/deposits", "/withdrawals", "/agent", "/admin", "/games", "/public"];

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
  server: { proxy: Object.fromEntries(api.map((p) => [p, "http://localhost:3000"])) },
});
