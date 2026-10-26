import { auditPublication } from './lib/publication-audit.mjs';

// Developer-only, read-only CLI. No default target, .env loading, network,
// callbacks or writes. A private denylist is never sent to the website API.
const invalid = () => ({ checked: 0, findings: [{ rule: 'INVALID_INPUT', path: '.' }], complete: false });
async function main(args) {
  const options = {}, keys = { '--directory': 'directory', '--git': 'git', '--forbidden-file': 'forbiddenFile' };
  let large = false;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--large-repository') {
      if (large) return invalid();
      large = true;
      continue;
    }
    const key = Object.hasOwn(keys, flag) ? keys[flag] : undefined, value = args[++index];
    if (!key || !value || value.startsWith('--') || options[key] !== undefined) return invalid();
    options[key] = value;
  }
  if (large) options.limits = {
    maxFileBytes: 64 * 1024 * 1024,
    maxTotalBytes: 3 * 1024 * 1024 * 1024,
    maxGitOutputBytes: 80 * 1024 * 1024,
    maxDecodeViews: 4096,
    maxDecodeQueue: 16384,
    maxDecodeCharsMultiplier: 128,
    maxFindings: 20000,
    gitTimeoutMs: 30000,
  };
  return auditPublication(options);
}
let result;
try { result = await main(process.argv.slice(2)); }
catch { result = { checked: 0, findings: [{ rule: 'AUDIT_FAILED', path: '.' }], complete: false }; }
process.stdout.write(JSON.stringify(result) + '\n');
process.exitCode = result.complete && result.findings.length === 0 ? 0 : 1;
