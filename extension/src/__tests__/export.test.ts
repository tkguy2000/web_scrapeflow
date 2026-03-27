import { describe, it, expect } from 'vitest';
import { jsonStrategy, csvStrategy, htmlStrategy } from '../lib/export';
import type { ScrapeResult } from '../lib/types';

const sampleData: ScrapeResult = {
  columns: ['Name', 'Price', 'Rating'],
  rows: [
    { Name: 'Widget A', Price: '$10.99', Rating: '4.5' },
    { Name: 'Widget B', Price: '$24.50', Rating: '3.8' },
    { Name: 'Widget C', Price: '$7.00', Rating: '5.0' },
  ],
  url: 'https://example.com/products',
  title: 'Products Page',
  timestamp: 1711500000000,
};

const emptyData: ScrapeResult = {
  columns: ['Col1'],
  rows: [],
  url: 'https://example.com',
  title: 'Empty',
  timestamp: 1711500000000,
};

describe('JSON Export', () => {
  it('올바른 JSON 배열 출력', () => {
    const output = jsonStrategy.export(sampleData);
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].Name).toBe('Widget A');
    expect(parsed[2].Rating).toBe('5.0');
  });

  it('빈 데이터 → 빈 배열', () => {
    const output = jsonStrategy.export(emptyData);
    expect(JSON.parse(output)).toEqual([]);
  });
});

describe('CSV Export', () => {
  it('헤더 + 데이터 행 출력', () => {
    const output = csvStrategy.export(sampleData);
    const lines = output.split('\n');
    expect(lines[0]).toBe('Name,Price,Rating');
    expect(lines).toHaveLength(4); // 헤더 + 3행
  });

  it('쉼표 포함 값 이스케이프', () => {
    const dataWithComma: ScrapeResult = {
      ...sampleData,
      rows: [{ Name: 'Item, with comma', Price: '$10', Rating: '4' }],
    };
    const output = csvStrategy.export(dataWithComma);
    expect(output).toContain('"Item, with comma"');
  });

  it('따옴표 포함 값 이스케이프', () => {
    const dataWithQuote: ScrapeResult = {
      ...sampleData,
      rows: [{ Name: 'Item "quoted"', Price: '$10', Rating: '4' }],
    };
    const output = csvStrategy.export(dataWithQuote);
    expect(output).toContain('"Item ""quoted"""');
  });

  it('줄바꿈 포함 값 이스케이프', () => {
    const dataWithNewline: ScrapeResult = {
      ...sampleData,
      rows: [{ Name: 'Line1\nLine2', Price: '$10', Rating: '4' }],
    };
    const output = csvStrategy.export(dataWithNewline);
    expect(output).toContain('"Line1\nLine2"');
  });

  it('빈 데이터 → 헤더만', () => {
    const output = csvStrategy.export(emptyData);
    expect(output).toBe('Col1');
  });

  it('null 값 처리', () => {
    const dataWithNull: ScrapeResult = {
      ...sampleData,
      rows: [{ Name: null, Price: '$10', Rating: '4' }],
    };
    const output = csvStrategy.export(dataWithNull);
    const lines = output.split('\n');
    expect(lines[1]).toMatch(/^,/); // Name이 빈 문자열
  });
});

describe('HTML Export', () => {
  it('올바른 HTML 테이블 구조', () => {
    const output = htmlStrategy.export(sampleData);
    expect(output).toContain('<!DOCTYPE html>');
    expect(output).toContain('<table>');
    expect(output).toContain('<th>Name</th>');
    expect(output).toContain('<td>Widget A</td>');
  });

  it('HTML 특수문자 이스케이프', () => {
    const dataWithHtml: ScrapeResult = {
      ...sampleData,
      rows: [{ Name: '<script>alert("xss")</script>', Price: '&amp;', Rating: '"quoted"' }],
    };
    const output = htmlStrategy.export(dataWithHtml);
    expect(output).toContain('&lt;script&gt;');
    expect(output).toContain('&amp;amp;');
    expect(output).toContain('&quot;quoted&quot;');
    expect(output).not.toContain('<script>alert');
  });

  it('타이틀 포함', () => {
    const output = htmlStrategy.export(sampleData);
    expect(output).toContain('Products Page');
  });

  it('행 카운트 표시', () => {
    const output = htmlStrategy.export(sampleData);
    expect(output).toContain('3행');
  });

  it('유니코드/이모지 처리', () => {
    const dataWithEmoji: ScrapeResult = {
      ...sampleData,
      rows: [{ Name: '상품 🎉', Price: '₩10,000', Rating: '⭐⭐⭐' }],
    };
    const output = htmlStrategy.export(dataWithEmoji);
    expect(output).toContain('상품 🎉');
    expect(output).toContain('₩10,000');
  });
});
