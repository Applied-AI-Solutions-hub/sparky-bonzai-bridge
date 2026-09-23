import { Bridge } from './bridge.ts';
import { loadConfig } from './config.ts';
import { listDevices } from './devices.ts';
import { createTurnRunner } from './openclaw.ts';
import { createHttpServer, NAME, VERSION } from './server.ts';

const cfg = loadConfig();
const bridge = new Bridge(cfg, createTurnRunner(cfg.openclawBin, `${cfg.stateDir}/tmp`));

const orphans = bridge.jobs.failOrphans();
bridge.jobs.prune();

const devices = listDevices(cfg.devicesFile);
if (devices.length === 0) {
  console.warn(`No devices registered in ${cfg.devicesFile}. Add one with: npm run device -- add iphone --label Kit`);
}

const server = createHttpServer(cfg, bridge);
server.listen(cfg.port, cfg.host, () => {
  console.log(`${NAME} ${VERSION} listening on http://${cfg.host}:${cfg.port}/mcp`);
  console.log(`agent=${cfg.openclawAgent} devices=${devices.map(d => d.id).join(',') || 'none'} orphaned_jobs_failed=${orphans}`);
});

function shutdown(signal: string): void {
  console.log(`${signal}: shutting down`);
  server.close();
  // Give in-flight Sparky turns a moment to record their results.
  void Promise.race([bridge.idle(), new Promise(r => setTimeout(r, 5000))]).then(() => process.exit(0));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
