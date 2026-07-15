import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

const testSupabaseUrl = process.env.VITE_SUPABASE_URL || "https://test-project.supabase.co";
const testSupabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "test-publishable-key";

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(testSupabaseUrl),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(testSupabaseKey),
    "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify("test-project"),
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    env: {
      VITE_SUPABASE_URL: testSupabaseUrl,
      VITE_SUPABASE_PUBLISHABLE_KEY: testSupabaseKey,
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
