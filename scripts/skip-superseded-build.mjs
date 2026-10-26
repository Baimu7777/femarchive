// Vercel ignoreCommand: exit 0 skips this build, exit 1 lets it run.
//
// A batch sync from the forum lands one commit per item, and every commit would
// start a full build (toolchain download plus Hugo). When a newer commit is
// already on the production branch, this one's build would be replaced within
// minutes anyway, so it is skipped; the newest commit always builds. Anything
// uncertain — not production, no network, unexpected output — builds as before.
import { execFileSync } from 'node:child_process';

const { VERCEL_ENV, VERCEL_GIT_COMMIT_SHA, VERCEL_GIT_COMMIT_REF, VERCEL_GIT_REPO_OWNER, VERCEL_GIT_REPO_SLUG } = process.env;
if (VERCEL_ENV !== 'production' || !VERCEL_GIT_COMMIT_SHA || !VERCEL_GIT_COMMIT_REF || !VERCEL_GIT_REPO_OWNER || !VERCEL_GIT_REPO_SLUG) process.exit(1);
try {
  const output = execFileSync('git', ['ls-remote', `https://github.com/${VERCEL_GIT_REPO_OWNER}/${VERCEL_GIT_REPO_SLUG}.git`, `refs/heads/${VERCEL_GIT_COMMIT_REF}`],
    { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] });
  const head = output.split(/\s+/)[0];
  if (/^[0-9a-f]{40}$/.test(head) && head !== VERCEL_GIT_COMMIT_SHA) {
    console.log(`Skipping ${VERCEL_GIT_COMMIT_SHA.slice(0, 7)}: ${VERCEL_GIT_COMMIT_REF} is already at ${head.slice(0, 7)}, which builds instead.`);
    process.exit(0);
  }
} catch { /* Build when in doubt. */ }
process.exit(1);
