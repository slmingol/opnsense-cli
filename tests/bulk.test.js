'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

jest.mock('../lib/opnsense', () => ({ getClient: jest.fn() }));
jest.mock('../lib/dns',      () => ({ addEntry: jest.fn(), addAlias: jest.fn(), getEntries: jest.fn() }));
jest.mock('../lib/haproxy',  () => ({ addBackend: jest.fn(), addFrontendRoute: jest.fn() }));

const { parseJSON, parseCSV, validate, serviceTarget } = require('../lib/bulk');

beforeEach(() => {
  delete process.env.SERVICES_HOST;
  delete process.env.SERVICES_DOMAIN;
});

// ---------------------------------------------------------------------------
// serviceTarget — precedence
// ---------------------------------------------------------------------------

describe('serviceTarget', () => {
  test('per-record host+domain win over everything', () => {
    process.env.SERVICES_HOST   = 'env-host';
    process.env.SERVICES_DOMAIN = 'env.lan';
    const t = serviceTarget({ host: 'record-host', domain: 'record.lan' });
    expect(t).toEqual({ host: 'record-host', domain: 'record.lan' });
  });

  test('legacy host_bub field accepted when host absent', () => {
    const t = serviceTarget({ host_bub: 'legacy-host' });
    expect(t.host).toBe('legacy-host');
  });

  test('env vars used when no per-record fields', () => {
    process.env.SERVICES_HOST   = 'env-host';
    process.env.SERVICES_DOMAIN = 'env.lan';
    const t = serviceTarget({});
    expect(t).toEqual({ host: 'env-host', domain: 'env.lan' });
  });

  test('falls back to hardcoded defaults', () => {
    const t = serviceTarget({});
    expect(t).toEqual({ host: 'docker-host-01-svcs', domain: 'bub.lan' });
  });

  test('per-record host overrides host_bub', () => {
    const t = serviceTarget({ host: 'explicit', host_bub: 'legacy' });
    expect(t.host).toBe('explicit');
  });
});

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

describe('validate', () => {
  test('valid services record passes', () => {
    const errs = validate({ services: [{ alias: 'app', port: '8080', description: 'My app' }] });
    expect(errs).toHaveLength(0);
  });

  test('missing alias reported', () => {
    const errs = validate({ services: [{ port: '8080', description: 'x' }] });
    expect(errs.some(e => e.includes('missing alias'))).toBe(true);
  });

  test('non-numeric port reported', () => {
    const errs = validate({ services: [{ alias: 'a', port: 'abc', description: 'x' }] });
    expect(errs.some(e => e.includes('port must be a number'))).toBe(true);
  });

  test('valid dns record passes', () => {
    const errs = validate({ dns: [{ host: 'h', domain: 'd.lan', ip: '1.2.3.4' }] });
    expect(errs).toHaveLength(0);
  });

  test('invalid IPv4 reported', () => {
    const errs = validate({ dns: [{ host: 'h', domain: 'd.lan', ip: 'not-an-ip' }] });
    expect(errs.some(e => e.includes('not IPv4'))).toBe(true);
  });

  test('missing dns fields all reported', () => {
    const errs = validate({ dns: [{}] });
    expect(errs.some(e => e.includes('missing host'))).toBe(true);
    expect(errs.some(e => e.includes('missing domain'))).toBe(true);
    expect(errs.some(e => e.includes('missing ip'))).toBe(true);
  });

  test('valid haproxy record passes', () => {
    const errs = validate({ haproxy: [{ name: 'n', server: 's', port: '443' }] });
    expect(errs).toHaveLength(0);
  });

  test('missing haproxy fields reported', () => {
    const errs = validate({ haproxy: [{}] });
    expect(errs.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// parseJSON
// ---------------------------------------------------------------------------

describe('parseJSON', () => {
  let tmpDir;
  beforeAll(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-test-')); });
  afterAll(() => { fs.rmSync(tmpDir, { recursive: true }); });

  function write(name, content) {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, content);
    return p;
  }

  test('parses object with dns key', () => {
    const p = write('dns.json', JSON.stringify({ dns: [{ host: 'h', domain: 'd', ip: '1.1.1.1' }] }));
    const r = parseJSON(p);
    expect(r.dns).toHaveLength(1);
  });

  test('wraps bare array as services', () => {
    const p = write('arr.json', JSON.stringify([{ alias: 'a', port: '80', description: 'x' }]));
    const r = parseJSON(p);
    expect(r.services).toHaveLength(1);
  });

  test('throws on invalid JSON', () => {
    const p = write('bad.json', 'not json');
    expect(() => parseJSON(p)).toThrow('Invalid JSON');
  });
});

// ---------------------------------------------------------------------------
// parseCSV
// ---------------------------------------------------------------------------

describe('parseCSV', () => {
  let tmpDir;
  beforeAll(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-test-')); });
  afterAll(() => { fs.rmSync(tmpDir, { recursive: true }); });

  function write(name, content) {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, content);
    return p;
  }

  test('parses dns CSV', () => {
    const p = write('dns.csv', 'host,domain,ip\nfoo,lan,1.2.3.4\n');
    const r = parseCSV(p);
    expect(r.dns).toHaveLength(1);
    expect(r.dns[0]).toMatchObject({ host: 'foo', domain: 'lan', ip: '1.2.3.4' });
  });

  test('parses services CSV', () => {
    const p = write('svc.csv', 'alias,port,description\nmyapp,8080,My app\n');
    const r = parseCSV(p);
    expect(r.services).toHaveLength(1);
    expect(r.services[0]).toMatchObject({ alias: 'myapp', port: '8080' });
  });

  test('parses haproxy CSV', () => {
    const p = write('hap.csv', 'name,server,port\nbackend1,10.0.0.1,443\n');
    const r = parseCSV(p);
    expect(r.haproxy).toHaveLength(1);
  });

  test('skips comment lines', () => {
    const p = write('comments.csv', '# comment\nhost,domain,ip\n# another\nbar,lan,5.6.7.8\n');
    const r = parseCSV(p);
    expect(r.dns).toHaveLength(1);
    expect(r.dns[0].host).toBe('bar');
  });

  test('throws on unknown headers', () => {
    const p = write('unknown.csv', 'foo,bar,baz\n1,2,3\n');
    expect(() => parseCSV(p)).toThrow('Cannot infer record type');
  });

  test('throws when only header row present', () => {
    const p = write('empty.csv', 'host,domain,ip\n');
    expect(() => parseCSV(p)).toThrow('at least one data row');
  });
});
