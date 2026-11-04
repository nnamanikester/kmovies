/**
 * Finds the TV on whatever network this computer is on, with no address to
 * configure. Anything found is only a candidate: the TV is confirmed by
 * connecting with the SSH key it was paired with, which no other device accepts.
 */
import { execFile } from 'node:child_process';
import dgram from 'node:dgram';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEV_MODE_PORT = 9922;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const SSDP_WAIT_MS = 3000;
const SCAN_CONCURRENCY = 128;
const SCAN_TIMEOUTS_MS = [500, 1500];
/** Networks larger than this (often VPNs) only have the nearby /24 scanned. */
const MIN_SCAN_PREFIX = 22;

const toNumber = (ip) => ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
const toIp = (n) => [n / 2 ** 24, n / 2 ** 16, n / 2 ** 8, n].map((part) => Math.floor(part) % 256).join('.');

/** Every IPv4 network this computer is on. */
export function localNetworks(interfaces = os.networkInterfaces()) {
  return Object.values(interfaces)
    .flat()
    .filter((iface) => iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.'))
    .map(({ address, netmask }) => ({ address, netmask }));
}

/** Other addresses on a network, excluding its network and broadcast addresses. */
export function hostsInNetwork({ address, netmask }) {
  const prefix = netmask.split('.').reduce((bits, part) => bits + Number(part).toString(2).replace(/0/g, '').length, 0);
  const mask = prefix < MIN_SCAN_PREFIX ? toNumber('255.255.255.0') : toNumber(netmask);
  const self = toNumber(address);
  const size = 2 ** 32 - mask;
  const first = self - (self % size);
  const hosts = [];
  for (let n = first + 1; n < first + size - 1; n += 1) {
    if (n !== self) hosts.push(toIp(n));
  }
  return hosts;
}

/** The computer's own address on the same network as `host`, or null if it shares none. */
export function addressFacing(host, networks = localNetworks()) {
  const match = networks.find((network) => hostsInNetwork(network).includes(host));
  return match ? match.address : null;
}

export function isPortOpen(host, port = DEV_MODE_PORT, timeout = 2000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeout, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

/** Asks the network for LG webOS TVs. These answer even with Developer Mode off. */
function askForLgTvs(networks) {
  const found = new Set();
  const request = Buffer.from(
    `M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP_ADDRESS}:${SSDP_PORT}\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: urn:lge-com:service:webos-second-screen:1\r\n\r\n`,
  );
  const searches = networks.map(({ address }) => new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    socket.on('error', () => resolve());
    socket.on('message', (message, sender) => {
      if (/webos-second-screen/i.test(message.toString())) found.add(sender.address);
    });
    socket.bind(0, address, () => {
      [0, 500, 1000].forEach((delay) => setTimeout(() => socket.send(request, SSDP_PORT, SSDP_ADDRESS, () => {}), delay));
      setTimeout(() => {
        socket.close();
        resolve();
      }, SSDP_WAIT_MS);
    });
  }));
  return Promise.all(searches).then(() => [...found]);
}

async function scanForDevMode(hosts, timeout) {
  const open = [];
  const queue = [...hosts];
  const worker = async () => {
    while (queue.length) {
      const host = queue.pop();
      if (await isPortOpen(host, DEV_MODE_PORT, timeout)) open.push(host);
    }
  };
  await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker));
  return open;
}

function ares(tool, args) {
  return new Promise((resolve) => {
    execFile(path.join(ROOT, 'node_modules', '.bin', tool), args, { timeout: 30000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: `${stdout}${stderr}` });
    });
  });
}

/** The address saved for this device name, or null. */
async function savedHost(device) {
  const { output } = await ares('ares-setup-device', ['--list']);
  const line = output.split('\n').find((text) => text.trim().startsWith(`${device} `));
  const match = line && /@([\d.]+):/.exec(line);
  return match ? match[1] : null;
}

/** Points the device at `host` and connects to it. @returns the model name if it's the paired TV. */
async function confirmTv(device, host) {
  const saved = await ares('ares-setup-device', ['--modify', device, '--info', `host=${host}`]);
  if (!saved.ok) return null;
  const { output } = await ares('ares-device', ['-i', '-d', device]);
  const model = /modelName\s*:\s*(\S+)/.exec(output);
  return model ? model[1] : null;
}

/**
 * @returns {Promise<{ host: string, model: string, computerAddress: string }>}
 * @throws {Error} explaining what to do when the TV can't be found
 */
export async function findTv(device = process.env.TV_DEVICE || 'tv') {
  const networks = localNetworks();
  if (networks.length === 0) throw new Error('This computer isn’t connected to a network.');
  const finish = (host, model) => ({ host, model, computerAddress: addressFacing(host, networks) });

  // Most runs: the TV hasn't moved.
  const last = await savedHost(device);
  if (last && addressFacing(last, networks) && (await isPortOpen(last))) {
    const model = await confirmTv(device, last);
    if (model) return finish(last, model);
  }

  const lgTvs = await askForLgTvs(networks);
  const hosts = networks.flatMap(hostsInNetwork);
  const tried = new Set();
  for (const timeout of SCAN_TIMEOUTS_MS) {
    const devModeHosts = await scanForDevMode(hosts, timeout);
    // LG TVs first, since other devices can have this port open too.
    const candidates = devModeHosts.sort((a, b) => lgTvs.includes(b) - lgTvs.includes(a));
    for (const host of candidates) {
      if (tried.has(host)) continue;
      tried.add(host);
      const model = await confirmTv(device, host);
      if (model) return finish(host, model);
    }
  }

  // Leave the saved device as it was, rather than on a candidate that failed.
  if (last) await ares('ares-setup-device', ['--modify', device, '--info', `host=${last}`]);

  const onNetworks = networks.map((network) => network.address).join(', ');
  if (tried.size > 0) {
    throw new Error(`Found Developer Mode at ${[...tried].join(', ')}, but it rejected this computer's key.\nOpen Developer Mode on the TV, turn on Key Server, then run: npx ares-novacom --device ${device} --getkey`);
  }
  if (lgTvs.length > 0) {
    throw new Error(`Found an LG TV at ${lgTvs.join(', ')}, but Developer Mode isn’t answering.\nOpen the Developer Mode app on the TV and check Dev Mode Status is on and hasn’t expired.`);
  }
  throw new Error(`No TV found on this computer's network (${onNetworks}).\nCheck the TV is on and connected to the same Wi-Fi or router as this computer.`);
}
