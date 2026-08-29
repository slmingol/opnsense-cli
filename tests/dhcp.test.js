'use strict';

const mockPost = jest.fn();
jest.mock('../lib/opnsense', () => ({
  getClient: jest.fn(() => ({ post: mockPost })),
}));

const { normalizeLease, listLeases } = require('../lib/dhcp');

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.DHCP_BACKEND;
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  console.log.mockRestore();
});

// ---------------------------------------------------------------------------
// normalizeLease — field mapping
// ---------------------------------------------------------------------------

describe('normalizeLease', () => {
  test('maps Kea fields', () => {
    const r = normalizeLease({
      address: '10.0.0.5', mac: 'aa:bb:cc:dd:ee:ff', hostname: 'myhost',
      state: 'active', status: 'online', ends: '2099-01-01', if_descr: 'LAN',
      type: 'dynamic', man: 'Apple',
    });
    expect(r).toEqual({
      address: '10.0.0.5', mac: 'aa:bb:cc:dd:ee:ff', hostname: 'myhost',
      state: 'active', status: 'online', ends: '2099-01-01', iface: 'LAN',
      type: 'dynamic', manufacturer: 'Apple',
    });
  });

  test('maps ISC fields (hwaddr, client-hostname, binding, expire, if)', () => {
    const r = normalizeLease({
      address: '192.168.1.10', hwaddr: '11:22:33:44:55:66',
      'client-hostname': 'ischost', binding: 'active',
      expire: '2099-06-01', if: 'em0',
    });
    expect(r.mac).toBe('11:22:33:44:55:66');
    expect(r.hostname).toBe('ischost');
    expect(r.state).toBe('active');
    expect(r.ends).toBe('2099-06-01');
    expect(r.iface).toBe('em0');
  });

  test('fills empty strings for missing fields', () => {
    const r = normalizeLease({});
    expect(r).toEqual({
      address: '', mac: '', hostname: '', state: '',
      status: '', ends: '', iface: '', type: '', manufacturer: '',
    });
  });

  test('prefers mac over hwaddr when both present', () => {
    const r = normalizeLease({ mac: 'primary', hwaddr: 'fallback' });
    expect(r.mac).toBe('primary');
  });
});

// ---------------------------------------------------------------------------
// listLeases — backend selection and filter
// ---------------------------------------------------------------------------

describe('listLeases — backend selection', () => {
  test('defaults to Kea endpoint', async () => {
    mockPost.mockResolvedValue({ data: { rows: [] } });
    await listLeases({});
    expect(mockPost).toHaveBeenCalledWith(
      '/api/kea/leases4/search',
      expect.any(Object)
    );
  });

  test('uses ISC endpoint when backend="isc"', async () => {
    mockPost.mockResolvedValue({ data: { rows: [] } });
    await listLeases({ backend: 'isc' });
    expect(mockPost).toHaveBeenCalledWith(
      '/api/dhcpv4/leases/search_lease',
      expect.any(Object)
    );
  });

  test('DHCP_BACKEND env var selects isc', async () => {
    process.env.DHCP_BACKEND = 'isc';
    mockPost.mockResolvedValue({ data: { rows: [] } });
    await listLeases({});
    expect(mockPost).toHaveBeenCalledWith('/api/dhcpv4/leases/search_lease', expect.any(Object));
  });

  test('--backend flag overrides DHCP_BACKEND env', async () => {
    process.env.DHCP_BACKEND = 'isc';
    mockPost.mockResolvedValue({ data: { rows: [] } });
    await listLeases({ backend: 'kea' });
    expect(mockPost).toHaveBeenCalledWith('/api/kea/leases4/search', expect.any(Object));
  });

  test('throws on unknown backend', async () => {
    await expect(listLeases({ backend: 'dnsmasq' }))
      .rejects.toThrow("Unknown DHCP backend 'dnsmasq'");
  });
});

describe('listLeases — filter', () => {
  const rows = [
    { address: '10.0.0.1', mac: 'aa:bb:cc:dd:ee:01', hostname: 'server01', if_descr: 'LAN' },
    { address: '10.0.0.2', mac: 'aa:bb:cc:dd:ee:02', hostname: 'desktop02', if_descr: 'WIFI' },
    { address: '10.0.0.3', mac: 'aa:bb:cc:dd:ee:03', hostname: 'printer',   if_descr: 'LAN' },
  ];

  beforeEach(() => {
    mockPost.mockResolvedValue({ data: { rows } });
  });

  test('no filter returns all leases', async () => {
    await listLeases({});
    const output = console.log.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('server01');
    expect(output).toContain('desktop02');
    expect(output).toContain('printer');
  });

  test('filter by hostname', async () => {
    await listLeases({ filter: 'server' });
    const output = console.log.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('server01');
    expect(output).not.toContain('desktop02');
    expect(output).not.toContain('printer');
  });

  test('filter by interface name', async () => {
    await listLeases({ filter: 'wifi' });
    const output = console.log.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('desktop02');
    expect(output).not.toContain('server01');
  });

  test('filter by IP', async () => {
    await listLeases({ filter: '10.0.0.3' });
    const output = console.log.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('printer');
    expect(output).not.toContain('server01');
  });

  test('filter with no match prints not-found message', async () => {
    await listLeases({ filter: 'doesnotexist' });
    const output = console.log.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('No leases matching "doesnotexist"');
  });
});
