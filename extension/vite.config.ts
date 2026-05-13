import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest.json';

// API 키는 빌드 결과물에 인라인하지 않는다. 확장은 클라이언트 코드라
// 빌드 시 주입한 시크릿은 dist를 분해하는 누구에게나 노출된다.
// 키는 popup UI에서 사용자가 직접 입력해 chrome.storage.sync에 저장한다.

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
