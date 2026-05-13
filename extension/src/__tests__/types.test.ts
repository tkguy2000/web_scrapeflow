import { describe, it, expect } from 'vitest';
import { MessageType, ScrapeFlowError } from '../lib/types';

describe('MessageType enum', () => {
  it('모든 스크래핑 메시지 타입 존재', () => {
    expect(MessageType.SCRAPE_START).toBe('SCRAPE_START');
    expect(MessageType.SCRAPE_RESULT).toBe('SCRAPE_RESULT');
    expect(MessageType.SCRAPE_ERROR).toBe('SCRAPE_ERROR');
  });

  it('모든 캡처 메시지 타입 존재', () => {
    expect(MessageType.CAPTURE_FULL_PAGE).toBe('CAPTURE_FULL_PAGE');
    expect(MessageType.CAPTURE_RESULT).toBe('CAPTURE_RESULT');
    expect(MessageType.CAPTURE_ERROR).toBe('CAPTURE_ERROR');
  });

  it('내보내기/상태 메시지 타입 존재', () => {
    expect(MessageType.EXPORT_DATA).toBe('EXPORT_DATA');
    expect(MessageType.GET_PAGE_INFO).toBe('GET_PAGE_INFO');
    expect(MessageType.PAGE_INFO).toBe('PAGE_INFO');
    expect(MessageType.OPEN_SIDE_PANEL).toBe('OPEN_SIDE_PANEL');
  });
});

describe('ScrapeFlowError enum', () => {
  it('모든 에러 타입 존재', () => {
    expect(ScrapeFlowError.SCRAPE_FAILED).toBe('SCRAPE_FAILED');
    expect(ScrapeFlowError.CAPTURE_FAILED).toBe('CAPTURE_FAILED');
    expect(ScrapeFlowError.EXPORT_FAILED).toBe('EXPORT_FAILED');
    expect(ScrapeFlowError.CDP_ATTACH_FAILED).toBe('CDP_ATTACH_FAILED');
    expect(ScrapeFlowError.PERMISSION_DENIED).toBe('PERMISSION_DENIED');
  });
});
