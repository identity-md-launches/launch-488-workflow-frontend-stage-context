import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { keccak256, stringToHex, isAddress } from 'viem';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.join(root, 'dist');
const input = JSON.parse(await readFile(new URL('../config/deployment-input.json', import.meta.url), 'utf8'));
const networkInput = JSON.parse(await readFile(new URL('../config/network-input.json', import.meta.url), 'utf8'));
const poolInput = JSON.parse(await readFile(new URL('../config/pool-input.json', import.meta.url), 'utf8'));
const checkOnly = process.argv.includes('--check');
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const abiHash = abi => keccak256(stringToHex(JSON.stringify(canonical(abi)))).slice(2);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const safePath = name => typeof name === 'string' && name.length > 0 && !name.startsWith('/') && !name.includes('\\') && !name.split('/').some(part => !part || part === '.' || part === '..') && !name.includes(':');
const hash = /^[a-f0-9]{64}$/;

assert(input.version === 1 && Number.isSafeInteger(input.chainId) && input.chainId > 0, 'Invalid handoff version or chain');
assert(Object.keys(networkInput).every(key => ['network', 'walletAddChain'].includes(key)), 'Unexpected network input field');
assert(/^[a-f0-9]{40}$/.test(input.sourceCommit) && hash.test(input.attestationHash), 'Invalid source or attestation hash');
assert(networkInput.network.chainId === input.chainId, 'Network does not match handoff chain');
assert(networkInput.walletAddChain.chainId.toLowerCase() === `0x${input.chainId.toString(16)}`, 'Wallet chain does not match handoff');
assert(new Set(input.contracts.map(c => c.name)).size === input.contracts.length, 'Duplicate contract name');
assert(JSON.stringify(canonical(poolInput)) === JSON.stringify(canonical({ ...input.manifest.pool, tokenContract: input.manifest.token.contract, hookContract: null })), 'Runtime pool parameters differ from pinned handoff');

// The pinned input files may be removed by the publishing worker. When available,
// check our reproducible build inputs against them; otherwise the attested copy remains.
for (const [file, expected] of [['deployment.json', input], ['network.json', networkInput]]) {
  let original;
  try { original = JSON.parse(await readFile(path.join(root, '.imd/reads', file), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; continue; }
  if (file === 'network.json') assert(JSON.stringify(canonical(original)) === JSON.stringify(canonical(expected)), 'Network input differs from supplied network');
  else {
    for (const key of ['version', 'launchId', 'chainId', 'sourceCommit', 'attestationHash']) assert(original[key] === expected[key], `Handoff ${key} mismatch`);
    assert(JSON.stringify(original.contracts.map(({ name, address, abiHash }) => ({ name, address, abiHash }))) === JSON.stringify(expected.contracts), 'Handoff contracts mismatch');
    for (const key of ['pool', 'token']) assert(JSON.stringify(canonical(original.manifest[key])) === JSON.stringify(canonical(expected.manifest[key])), `Handoff ${key} mismatch`);
  }
}

const contracts = [];
for (const entry of input.contracts) {
  assert(/^[A-Za-z][A-Za-z0-9_]*$/.test(entry.name) && isAddress(entry.address) && hash.test(entry.abiHash), 'Invalid contract identity');
  const abiPath = `abi/${entry.name}.json`;
  // Read the implementation-derived ABI from the attested Git object, never from
  // generated artifacts belonging to a different source revision.
  const sourceBytes = execFileSync('git', ['show', `${input.sourceCommit}:docs/${abiPath}`], { cwd: root });
  const abi = JSON.parse(sourceBytes.toString('utf8'));
  assert(Array.isArray(abi), `${entry.name} ABI must be a raw JSON array`);
  assert(abiHash(abi) === entry.abiHash, `${entry.name} canonical ABI hash differs from handoff`);
  if (!checkOnly) {
    await mkdir(path.join(output, 'abi'), { recursive: true });
    await writeFile(path.join(output, abiPath), sourceBytes);
  }
  const exported = JSON.parse(await readFile(path.join(output, abiPath), 'utf8'));
  assert(abiHash(exported) === entry.abiHash, `${entry.name} exported ABI differs from attestation`);
  contracts.push({ ...entry, abiPath });
}

async function inventory(directory, prefix = '') {
  const result = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix + entry.name;
    assert(safePath(name), `Unsafe export path: ${name}`);
    assert(!entry.isSymbolicLink(), `Symlink not allowed in export: ${name}`);
    if (entry.isDirectory()) result.push(...await inventory(path.join(directory, entry.name), `${name}/`));
    else {
      assert(entry.isFile(), `Non-file export: ${name}`);
      if (name === 'imd-deployment.json') continue;
      const bytes = await readFile(path.join(directory, entry.name));
      assert(bytes.length <= 8 * 1024 * 1024, `Export asset exceeds 8 MiB: ${name}`);
      result.push({ path: name, sha256: sha256(bytes) });
    }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
const assets = await inventory(output);
assert(assets.length <= 128 && assets.some(a => a.path === 'index.html'), 'Missing index.html or too many assets');
const expected = {
  version: 1, launchId: input.launchId, chainId: input.chainId,
  sourceCommit: input.sourceCommit, attestationHash: input.attestationHash,
  contracts, assets, ...networkInput,
};
if (!checkOnly) await writeFile(path.join(output, 'imd-deployment.json'), JSON.stringify(expected, null, 2) + '\n');
const actual = JSON.parse(await readFile(path.join(output, 'imd-deployment.json'), 'utf8'));
assert(Object.keys(actual).sort().join(',') === Object.keys(expected).sort().join(','), 'Deployment manifest contains missing or extra top-level keys');
assert(JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected)), 'Manifest differs from final export, network, or handoff');
const total = (await Promise.all(assets.map(async asset => (await stat(path.join(output, asset.path))).size))).reduce((a, b) => a + b, 0)
  + (await stat(path.join(output, 'imd-deployment.json'))).size;
assert(total < 30 * 1024 * 1024, 'Export exceeds safe HTTP response budget');
console.log(`Deployment verified: ${contracts.length} pinned ABIs; ${assets.length} SHA-256 assets; ${total} exported bytes; source ${input.sourceCommit}.`);
