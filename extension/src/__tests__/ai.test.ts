import { describe, it, expect, vi, beforeEach } from 'vitest';

// chrome.storage mock
const mockStorage: Record<string, unknown> = {};
vi.stubGlobal('chrome', {
  storage: {
    sync: {
      get: vi.fn(async (key: string) => ({ [key]: mockStorage[key] })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(mockStorage, items);
      }),
    },
  },
});

// import 후 mock이 적용되도록
const { getApiKey, setApiKey } = await import('../lib/ai');

describe('API Key Management', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockStorage)) delete mockStorage[key];
  });

  it('키가 없으면 null 반환', async () => {
    const key = await getApiKey();
    expect(key).toBeNull();
  });

  it('키 저장 후 조회', async () => {
    await setApiKey('sk-ant-test-key');
    mockStorage['sf_api_key'] = 'sk-ant-test-key';
    const key = await getApiKey();
    expect(key).toBe('sk-ant-test-key');
  });
});

describe('inferDataStructure', () => {
  it('API 키 없으면 에러 throw', async () => {
    // storage를 확실히 비운 상태에서 테스트
    delete mockStorage['sf_api_key'];
    // 모듈 재import해서 새 mock 상태 반영
    vi.resetModules();

    vi.stubGlobal('chrome', {
      storage: {
        sync: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => {}),
        },
      },
    });

    const { inferDataStructure } = await import('../lib/ai');
    await expect(
      inferDataStructure('이름과 가격', '<html></html>', 'https://example.com')
    ).rejects.toThrow('API_KEY_NOT_SET');
  });
});
