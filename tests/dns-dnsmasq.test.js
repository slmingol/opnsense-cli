'use strict';

jest.mock('../lib/opnsense', () => ({ getClient: jest.fn() }));

const { splitList, hostPayload } = require('../lib/dns-dnsmasq');

// ---------------------------------------------------------------------------
// splitList
// ---------------------------------------------------------------------------

describe('splitList', () => {
  test('splits comma-separated string', () => {
    expect(splitList('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  test('trims whitespace around entries', () => {
    expect(splitList('a , b , c')).toEqual(['a', 'b', 'c']);
  });

  test('filters empty entries', () => {
    expect(splitList('a,,b')).toEqual(['a', 'b']);
  });

  test('returns empty array for null', () => {
    expect(splitList(null)).toEqual([]);
  });

  test('returns empty array for empty string', () => {
    expect(splitList('')).toEqual([]);
  });

  test('returns empty array for undefined', () => {
    expect(splitList(undefined)).toEqual([]);
  });

  test('single entry returns single-element array', () => {
    expect(splitList('only')).toEqual(['only']);
  });
});

// ---------------------------------------------------------------------------
// hostPayload
// ---------------------------------------------------------------------------

describe('hostPayload', () => {
  const BASE_ROW = {
    host: 'myhost', domain: 'lan', local: '1', ip: '10.0.0.1',
    cnames: 'alias.lan', client_id: 'cid1', hwaddr: 'aa:bb:cc:dd:ee:ff',
    lease_time: '86400', ignore: '0', set_tag: '', descr: 'my host',
    comments: 'note', aliases: '',
  };

  test('wraps all row fields under host key', () => {
    const p = hostPayload(BASE_ROW);
    expect(p).toHaveProperty('host');
    expect(p.host.host).toBe('myhost');
    expect(p.host.domain).toBe('lan');
  });

  test('preserves all DHCP reservation fields', () => {
    const p = hostPayload(BASE_ROW);
    expect(p.host.hwaddr).toBe('aa:bb:cc:dd:ee:ff');
    expect(p.host.client_id).toBe('cid1');
    expect(p.host.lease_time).toBe('86400');
  });

  test('overrides apply over row fields', () => {
    const p = hostPayload(BASE_ROW, { ip: '10.0.0.99', descr: 'updated' });
    expect(p.host.ip).toBe('10.0.0.99');
    expect(p.host.descr).toBe('updated');
    expect(p.host.host).toBe('myhost'); // unchanged
  });

  test('defaults local to 1 when missing', () => {
    const p = hostPayload({ host: 'h', domain: 'd' });
    expect(p.host.local).toBe('1');
  });

  test('defaults ignore to 0 when missing', () => {
    const p = hostPayload({ host: 'h', domain: 'd' });
    expect(p.host.ignore).toBe('0');
  });

  test('empty string defaults for optional string fields', () => {
    const p = hostPayload({ host: 'h', domain: 'd' });
    expect(p.host.ip).toBe('');
    expect(p.host.cnames).toBe('');
    expect(p.host.hwaddr).toBe('');
    expect(p.host.descr).toBe('');
  });

  test('override can add new fields', () => {
    const p = hostPayload(BASE_ROW, { extra_field: 'extra' });
    expect(p.host.extra_field).toBe('extra');
  });
});
