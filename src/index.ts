import { config } from './config.js';
import { seedDemoData } from './demoSeed.js';
import { log } from './log.js';
import { buildApp } from './server.js';
import { startPolicyWatcher } from './pipeline/policy.js';

startPolicyWatcher();

const app = buildApp();

app.listen(config.port, () => {
  log.info(
    { port: config.port, mockMode: config.mockMode },
    'tokenomics gateway listening',
  );
  seedDemoData();
});
