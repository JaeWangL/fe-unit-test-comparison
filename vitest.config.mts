import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'path';

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    globals: true, // describe, it 등을 전역으로 사용
    environment: 'jsdom',
    css: false, // CSS 처리 비활성화 (테스트 속도 향상을 위함)
    include: ['./__tests__/vitest/**/*.test.{ts,tsx}'],
    setupFiles: './__tests__/vitest/setup/vitest.setup.ts',
    alias: {
      '@': path.resolve(__dirname, './src'), // @ 경로 별칭 설정
    },
  },
});
