import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Ensure a fresh, isolated SQLite db per test run.
const dir = mkdtempSync(join(tmpdir(), 'tokenomics-test-'));
process.env.SQLITE_PATH = join(dir, 'gateway.db');
process.env.MOCK_MODE = 'true';
process.env.MOCK_FAILURE_RATE = '0';
process.env.LOG_LEVEL = 'silent';

// Default to an empty policy so P1 tests are unaffected by the repo's policy.yaml.
const emptyPolicyPath = join(dir, 'policy.yaml');
writeFileSync(emptyPolicyPath, 'version: 1\nrules: []\n');
process.env.POLICY_PATH = emptyPolicyPath;
