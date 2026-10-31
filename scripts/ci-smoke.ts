import { spawnSync } from 'node:child_process';

const [label, command, ...args] = process.argv.slice(2);
if (!label || !command) {
  console.error('Usage: node scripts/ci-smoke.ts <label> <command> [args...]');
  process.exit(1);
}

const actions = process.env.GITHUB_ACTIONS === 'true';
console.log(`[RUN] ${label}`);
if (actions) console.log(`::group::${label}: full output (includes system diagnostics)`);
console.log(
  '[INFO] macOS backupd XPC messages can appear during successful checks. The result below uses the command exit code.',
);
const result = spawnSync(command, args, { stdio: 'inherit' });
if (result.error) console.error(result.error);
if (actions) console.log('::endgroup::');

const code = result.status ?? 1;
if (code === 0) {
  console.log(`[PASS] ${label}`);
} else {
  const failure = `${label}: ${result.signal ? `signal ${result.signal}` : `exit code ${code}`}. See full output above.`;
  console.error(`[FAIL] ${failure}`);
  if (actions) console.log(`::error::${failure}`);
}
process.exit(code);
