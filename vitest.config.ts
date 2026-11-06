import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Tests under web/ choose jsdom with a `@vitest-environment` comment. Everything else runs in node.
export default defineConfig({
  plugins: [react()],
});
