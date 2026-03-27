import { defineConfig, loadEnv } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest.json';

export default defineConfig(({ mode }) => {
  // 상위 디렉토리(..)의 .env 파일을 로드
  const env = loadEnv(mode, '..', '');

  return {
    plugins: [crx({ manifest })],
    define: {
      '__CLAUDE_API_KEY__': JSON.stringify(env['CLAUDE_API_KEY'] || ''),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  };
});
