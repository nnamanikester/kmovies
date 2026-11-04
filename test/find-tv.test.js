import assert from 'node:assert/strict';
import test from 'node:test';
import { addressFacing, hostsInNetwork, localNetworks } from '../scripts/find-tv.mjs';

test('hostsInNetwork covers a /24, leaving out this computer and the reserved addresses', () => {
  const hosts = hostsInNetwork({ address: '192.168.1.56', netmask: '255.255.255.0' });
  assert.equal(hosts.length, 253);
  assert.ok(hosts.includes('192.168.1.1'));
  assert.ok(hosts.includes('192.168.1.254'));
  assert.ok(!hosts.includes('192.168.1.56'));
  assert.ok(!hosts.includes('192.168.1.0'));
  assert.ok(!hosts.includes('192.168.1.255'));
});

test('hostsInNetwork spans the whole of a /22, as on the TV network', () => {
  const hosts = hostsInNetwork({ address: '192.168.68.51', netmask: '255.255.252.0' });
  assert.equal(hosts.length, 1021);
  assert.ok(hosts.includes('192.168.68.56'));
  assert.ok(hosts.includes('192.168.71.254'));
  assert.ok(!hosts.includes('192.168.72.1'));
});

test('hostsInNetwork limits very large networks to the nearby /24', () => {
  assert.equal(hostsInNetwork({ address: '10.8.3.4', netmask: '255.0.0.0' }).length, 253);
});

test('addressFacing picks the computer address that shares a network with the TV', () => {
  const networks = [
    { address: '10.8.3.4', netmask: '255.255.255.0' },
    { address: '192.168.68.51', netmask: '255.255.252.0' },
  ];
  assert.equal(addressFacing('192.168.70.9', networks), '192.168.68.51');
  assert.equal(addressFacing('172.16.0.2', networks), null);
});

test('localNetworks ignores loopback and self-assigned addresses', () => {
  const networks = localNetworks({
    lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1', netmask: '255.0.0.0' }],
    en0: [
      { family: 'IPv6', internal: false, address: 'fe80::1', netmask: 'ffff::' },
      { family: 'IPv4', internal: false, address: '192.168.1.56', netmask: '255.255.255.0' },
    ],
    en5: [{ family: 'IPv4', internal: false, address: '169.254.1.2', netmask: '255.255.0.0' }],
  });
  assert.deepEqual(networks, [{ address: '192.168.1.56', netmask: '255.255.255.0' }]);
});
