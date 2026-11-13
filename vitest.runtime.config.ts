import base from './vitest.config.ts';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  ...base,
  test: { ...base.test, include: ['tests/runtime/*.runtime.ts'], testTimeout: 30000 },
});
