import { describe, expect, it } from 'vitest';

function normaliseHostname(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  try {
    return new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return trimmed;
  }
}

describe('normaliseHostname', () => {
  it('lowercases a plain hostname', () => {
    expect(normaliseHostname('Example.COM')).toBe('example.com');
  });

  it('strips protocol and path from a full URL', () => {
    expect(normaliseHostname('https://meet.google.com/room?id=123')).toBe('meet.google.com');
  });

  it('strips www prefix when given as part of the hostname', () => {
    expect(normaliseHostname('www.example.com')).toBe('www.example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(normaliseHostname('  example.com  ')).toBe('example.com');
  });

  it('returns the trimmed string for an invalid URL-like input', () => {
    expect(normaliseHostname('not a url')).toBe('not a url');
  });

  it('handles URLs without protocol by prepending https', () => {
    expect(normaliseHostname('example.com/path')).toBe('example.com');
  });

  it('preserves subdomains', () => {
    expect(normaliseHostname('sub.domain.example.com')).toBe('sub.domain.example.com');
  });
});
