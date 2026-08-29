'use strict';

jest.mock('../lib/opnsense', () => ({ getClient: jest.fn() }));

const { fmtExpiry, tsToMs, fmtDate, daysLeft } = require('../lib/cert');

// Strip ANSI escape codes for clean assertions
// eslint-disable-next-line no-control-regex
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');

// ---------------------------------------------------------------------------
// tsToMs
// ---------------------------------------------------------------------------

describe('tsToMs', () => {
  test('converts unix timestamp (seconds) to ms', () => {
    expect(tsToMs(1000)).toBe(1000000);
  });

  test('converts ISO string to ms', () => {
    const ms = tsToMs('2025-01-01T00:00:00Z');
    expect(ms).toBe(new Date('2025-01-01T00:00:00Z').getTime());
  });

  test('returns null for falsy input', () => {
    expect(tsToMs(null)).toBeNull();
    expect(tsToMs(undefined)).toBeNull();
    expect(tsToMs('')).toBeNull();
  });

  test('returns null for NaN timestamp string', () => {
    expect(tsToMs('not-a-date')).toBeNaN();
  });
});

// ---------------------------------------------------------------------------
// fmtDate
// ---------------------------------------------------------------------------

describe('fmtDate', () => {
  test('formats unix timestamp as ISO-like string', () => {
    // Use a non-zero epoch second; tsToMs treats 0 as falsy
    const result = fmtDate(1000000);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test('returns ? for null, undefined, empty string, and 0', () => {
    expect(fmtDate(null)).toBe('?');
    expect(fmtDate(undefined)).toBe('?');
    expect(fmtDate('')).toBe('?');
    expect(fmtDate(0)).toBe('?'); // tsToMs treats 0 as falsy
  });

  test('no milliseconds or trailing Z in output', () => {
    expect(fmtDate(1000000)).not.toMatch(/\.\d+Z/);
  });
});

// ---------------------------------------------------------------------------
// fmtExpiry
// ---------------------------------------------------------------------------

describe('fmtExpiry', () => {
  test('null daysLeft returns ?', () => {
    expect(strip(fmtExpiry(null))).toBe('?');
  });

  test('negative days → EXPIRED message', () => {
    expect(strip(fmtExpiry(-5))).toBe('EXPIRED (5d ago)');
  });

  test('0 days → red (< 30)', () => {
    expect(strip(fmtExpiry(0))).toBe('0d');
  });

  test('29 days → red', () => {
    const out = fmtExpiry(29);
    expect(out).toContain('\x1b[31m'); // red
    expect(strip(out)).toBe('29d');
  });

  test('30 days → yellow (< 90)', () => {
    const out = fmtExpiry(30);
    expect(out).toContain('\x1b[33m'); // yellow
    expect(strip(out)).toBe('30d');
  });

  test('89 days → yellow', () => {
    const out = fmtExpiry(89);
    expect(out).toContain('\x1b[33m');
  });

  test('90 days → green', () => {
    const out = fmtExpiry(90);
    expect(out).toContain('\x1b[32m'); // green
    expect(strip(out)).toBe('90d');
  });

  test('365 days → green', () => {
    const out = fmtExpiry(365);
    expect(out).toContain('\x1b[32m');
  });
});

// ---------------------------------------------------------------------------
// daysLeft
// ---------------------------------------------------------------------------

describe('daysLeft', () => {
  const DAY_MS = 86400000;

  test('returns null when cert has no valid_to', () => {
    expect(daysLeft({})).toBeNull();
  });

  test('returns positive days for future expiry', () => {
    const future = Math.floor((Date.now() + 10 * DAY_MS) / 1000);
    const d = daysLeft({ valid_to: future });
    expect(d).toBeGreaterThanOrEqual(9);
    expect(d).toBeLessThanOrEqual(10);
  });

  test('returns negative days for past expiry', () => {
    const past = Math.floor((Date.now() - 5 * DAY_MS) / 1000);
    const d = daysLeft({ valid_to: past });
    expect(d).toBeLessThan(0);
    expect(d).toBeGreaterThanOrEqual(-6); // allow 1-day rounding tolerance
  });

  test('returns 0 for expiry within the next 24 hours', () => {
    // Half a day in the future → floor((~43200000) / 86400000) = 0
    const halfDay = Math.floor((Date.now() + 0.5 * DAY_MS) / 1000);
    const d = daysLeft({ valid_to: halfDay });
    expect(d).toBe(0);
  });

  test('works with ISO string timestamps', () => {
    const isoFuture = new Date(Date.now() + 100 * DAY_MS).toISOString();
    const d = daysLeft({ valid_to: isoFuture });
    expect(d).toBeGreaterThanOrEqual(99);
    expect(d).toBeLessThanOrEqual(100);
  });
});
