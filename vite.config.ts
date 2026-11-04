import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const companion = "http://127.0.0.1:4646";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { "/api": companion, "/media": companion },
  },
});
