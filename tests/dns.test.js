'use strict';

jest.mock('../lib/opnsense', () => ({
  getClient: jest.fn(),
}));

jest.mock('../lib/dns-unbound', () => ({
  listEntries:  jest.fn().mockResolvedValue(undefined),
  addEntry:     jest.fn().mockResolvedValue(undefined),
  updateEntry:  jest.fn().mockResolvedValue(undefined),
  deleteEntry:  jest.fn().mockResolvedValue(undefined),
  addAlias:     jest.fn().mockResolvedValue(undefined),
  deleteAlias:  jest.fn().mockResolvedValue(undefined),
  getEntries:   jest.fn().mockResolvedValue([]),
}));

jest.mock('../lib/dns-dnsmasq', () => ({
  listEntries:  jest.fn().mockResolvedValue(undefined),
  addEntry:     jest.fn().mockResolvedValue(undefined),
  updateEntry:  jest.fn().mockResolvedValue(undefined),
  deleteEntry:  jest.fn().mockResolvedValue(undefined),
  addAlias:     jest.fn().mockResolvedValue(undefined),
  deleteAlias:  jest.fn().mockResolvedValue(undefined),
  getEntries:   jest.fn().mockResolvedValue([]),
}));

const unbound = require('../lib/dns-unbound');
const dnsmasq = require('../lib/dns-dnsmasq');
const dns     = require('../lib/dns');

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.DNS_BACKEND;
});

describe('dns dispatcher — backend selection', () => {
  test('defaults to unbound when no backend given', async () => {
    await dns.listEntries(null, undefined);
    expect(unbound.listEntries).toHaveBeenCalledTimes(1);
    expect(dnsmasq.listEntries).not.toHaveBeenCalled();
  });

  test('uses unbound when backend="unbound"', async () => {
    await dns.listEntries(null, 'unbound');
    expect(unbound.listEntries).toHaveBeenCalledTimes(1);
    expect(dnsmasq.listEntries).not.toHaveBeenCalled();
  });

  test('uses dnsmasq when backend="dnsmasq"', async () => {
    await dns.listEntries(null, 'dnsmasq');
    expect(dnsmasq.listEntries).toHaveBeenCalledTimes(1);
    expect(unbound.listEntries).not.toHaveBeenCalled();
  });

  test('DNS_BACKEND env var selects dnsmasq', async () => {
    process.env.DNS_BACKEND = 'dnsmasq';
    await dns.listEntries(null, undefined);
    expect(dnsmasq.listEntries).toHaveBeenCalledTimes(1);
    expect(unbound.listEntries).not.toHaveBeenCalled();
  });

  test('--backend flag overrides DNS_BACKEND env var', async () => {
    process.env.DNS_BACKEND = 'dnsmasq';
    await dns.listEntries(null, 'unbound');
    expect(unbound.listEntries).toHaveBeenCalledTimes(1);
    expect(dnsmasq.listEntries).not.toHaveBeenCalled();
  });

  test('throws on unknown backend', () => {
    expect(() => dns.listEntries(null, 'bind9')).toThrow("Unknown DNS backend 'bind9'");
  });

  test('backend name is case-insensitive', async () => {
    await dns.listEntries(null, 'Dnsmasq');
    expect(dnsmasq.listEntries).toHaveBeenCalledTimes(1);
  });
});

describe('dns dispatcher — routing', () => {
  test('addEntry strips backend before forwarding', async () => {
    await dns.addEntry({ host: 'foo', domain: 'lan', ip: '1.2.3.4', backend: 'unbound' });
    expect(unbound.addEntry).toHaveBeenCalledWith({ host: 'foo', domain: 'lan', ip: '1.2.3.4' });
  });

  test('deleteEntry passes host+domain to backend', async () => {
    await dns.deleteEntry('foo', 'lan', 'dnsmasq');
    expect(dnsmasq.deleteEntry).toHaveBeenCalledWith('foo', 'lan');
  });

  test('getEntries delegates to correct backend', async () => {
    await dns.getEntries('dnsmasq');
    expect(dnsmasq.getEntries).toHaveBeenCalledTimes(1);
    expect(unbound.getEntries).not.toHaveBeenCalled();
  });
});
