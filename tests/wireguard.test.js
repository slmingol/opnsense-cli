'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

jest.mock('../lib/opnsense', () => ({ getClient: jest.fn() }));
jest.mock('../lib/firewall',  () => ({ createOrUpdateAlias: jest.fn(), deleteAlias: jest.fn() }));

const { parseWireGuardConf, deriveGatewayIP } = require('../lib/wireguard');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_CONF = `
[Interface]
PrivateKey = abc123privatekey==
Address    = 10.68.0.2/32
DNS        = 10.68.0.1

[Peer]
PublicKey    = xyz789pubkey==
PresharedKey = psk999==
Endpoint     = vpn.example.com:51820
AllowedIPs   = 0.0.0.0/0, ::/0
`;

const CONF_NO_DNS = `
[Interface]
PrivateKey = abc123privatekey==
Address    = 10.68.0.5/32

[Peer]
PublicKey  = xyz789pubkey==
Endpoint   = vpn.example.com:51820
AllowedIPs = 0.0.0.0/0
`;

let tmpDir;
beforeAll(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-test-')); });
afterAll(()  => { fs.rmSync(tmpDir, { recursive: true }); });

function writeConf(name, content) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content);
  return p;
}

beforeEach(() => { delete process.env.WG_PRIVATE_KEY; });

// ---------------------------------------------------------------------------
// parseWireGuardConf
// ---------------------------------------------------------------------------

describe('parseWireGuardConf', () => {
  test('parses interface fields', () => {
    const p = writeConf('valid.conf', VALID_CONF);
    const r = parseWireGuardConf(p);
    expect(r.interface.address).toBe('10.68.0.2/32');
    expect(r.interface.privateKey).toBe('abc123privatekey==');
    expect(r.interface.dns).toBe('10.68.0.1');
  });

  test('parses peer fields', () => {
    const p = writeConf('peer.conf', VALID_CONF);
    const r = parseWireGuardConf(p);
    expect(r.peer.publicKey).toBe('xyz789pubkey==');
    expect(r.peer.presharedKey).toBe('psk999==');
    expect(r.peer.endpoint).toBe('vpn.example.com');
    expect(r.peer.port).toBe(51820);
  });

  test('parses AllowedIPs as array', () => {
    const p = writeConf('allowedips.conf', VALID_CONF);
    const r = parseWireGuardConf(p);
    expect(r.peer.allowedIPs).toEqual(['0.0.0.0/0', '::/0']);
  });

  test('strips comments and blank lines', () => {
    const conf = `# this is a comment\n\n[Interface]\nPrivateKey = k==\nAddress = 10.0.0.1/32\n\n[Peer]\nPublicKey = p==\nEndpoint = h:51820\nAllowedIPs = 0.0.0.0/0\n`;
    const p = writeConf('comments.conf', conf);
    const r = parseWireGuardConf(p);
    expect(r.interface.privateKey).toBe('k==');
  });

  test('WG_PRIVATE_KEY env overrides conf PrivateKey', () => {
    process.env.WG_PRIVATE_KEY = 'envkey==';
    const p = writeConf('envkey.conf', VALID_CONF);
    const r = parseWireGuardConf(p);
    expect(r.interface.privateKey).toBe('envkey==');
  });

  test('throws when PrivateKey missing and no env var', () => {
    const conf = `[Interface]\nAddress = 10.0.0.1/32\n[Peer]\nPublicKey = p==\nEndpoint = h:51820\nAllowedIPs = 0.0.0.0/0\n`;
    const p = writeConf('noprivkey.conf', conf);
    expect(() => parseWireGuardConf(p)).toThrow('private key');
  });

  test('throws when PublicKey missing', () => {
    const conf = `[Interface]\nPrivateKey = k==\nAddress = 10.0.0.1/32\n[Peer]\nEndpoint = h:51820\nAllowedIPs = 0.0.0.0/0\n`;
    const p = writeConf('nopubkey.conf', conf);
    expect(() => parseWireGuardConf(p)).toThrow('PublicKey');
  });

  test('throws when Endpoint missing', () => {
    const conf = `[Interface]\nPrivateKey = k==\nAddress = 10.0.0.1/32\n[Peer]\nPublicKey = p==\nAllowedIPs = 0.0.0.0/0\n`;
    const p = writeConf('noendpoint.conf', conf);
    expect(() => parseWireGuardConf(p)).toThrow('Endpoint');
  });

  test('parses multi-key = value lines correctly (value may contain =)', () => {
    const conf = `[Interface]\nPrivateKey = base64key+with/equals==\nAddress = 10.0.0.1/32\n[Peer]\nPublicKey = pub==\nEndpoint = h:51820\nAllowedIPs = 0.0.0.0/0\n`;
    const p = writeConf('equalsval.conf', conf);
    const r = parseWireGuardConf(p);
    expect(r.interface.privateKey).toBe('base64key+with/equals==');
  });

  test('only uses first address when multiple given', () => {
    const conf = `[Interface]\nPrivateKey = k==\nAddress = 10.0.0.1/32, fd00::1/128\n[Peer]\nPublicKey = p==\nEndpoint = h:51820\nAllowedIPs = 0.0.0.0/0\n`;
    const p = writeConf('multiaddr.conf', conf);
    const r = parseWireGuardConf(p);
    expect(r.interface.address).toBe('10.0.0.1/32');
  });
});

// ---------------------------------------------------------------------------
// deriveGatewayIP
// ---------------------------------------------------------------------------

describe('deriveGatewayIP', () => {
  test('returns DNS when present', () => {
    const p = writeConf('dns.conf', VALID_CONF);
    const cfg = parseWireGuardConf(p);
    expect(deriveGatewayIP(cfg)).toBe('10.68.0.1');
  });

  test('derives gateway by decrementing last octet when no DNS', () => {
    const p = writeConf('nodns.conf', CONF_NO_DNS);
    const cfg = parseWireGuardConf(p);
    expect(deriveGatewayIP(cfg)).toBe('10.68.0.4');
  });

  test('handles .1 address → gateway .0', () => {
    const conf = `[Interface]\nPrivateKey = k==\nAddress = 192.168.1.1/24\n[Peer]\nPublicKey = p==\nEndpoint = h:51820\nAllowedIPs = 0.0.0.0/0\n`;
    const p = writeConf('gateway0.conf', conf);
    const cfg = parseWireGuardConf(p);
    expect(deriveGatewayIP(cfg)).toBe('192.168.1.0');
  });
});
