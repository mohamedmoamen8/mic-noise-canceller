import { describe, expect, it } from 'vitest';

function hostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

describe('hostnameFromUrl', () => {
  it('extracts the hostname from a standard URL', () => {
    expect(hostnameFromUrl('https://meet.google.com/abc-def-ghi')).toBe('meet.google.com');
  });

  it('extracts the hostname from a URL with a port', () => {
    expect(hostnameFromUrl('https://localhost:3000/path')).toBe('localhost');
  });

  it('returns null for an invalid URL', () => {
    expect(hostnameFromUrl('not a url')).toBe(null);
  });

  it('returns null for an empty string', () => {
    expect(hostnameFromUrl('')).toBe(null);
  });

  it('extracts the hostname from a subdomain', () => {
    expect(hostnameFromUrl('https://sub.example.com/')).toBe('sub.example.com');
  });

  it('extracts the hostname from a URL with query parameters', () => {
    expect(hostnameFromUrl('https://example.com?foo=bar')).toBe('example.com');
  });

  it('extracts the hostname from a URL with a hash fragment', () => {
    expect(hostnameFromUrl('https://example.com#section')).toBe('example.com');
  });
});
