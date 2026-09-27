// Runs the API gateway and the Vite dev server side by side.
// PORT (if set, e.g. by a preview launcher) belongs to Vite; the gateway uses
// GATEWAY_PORT (default 8787) so the two never compete for the same port.
import { spawn } from 'node:child_process';

const gatewayPort = process.env.GATEWAY_PORT || '8787';
const procs = [
  spawn(process.execPath, ['--watch', 'server/index.js'], { stdio: 'inherit', env: { ...process.env, PORT: gatewayPort, GATEWAY_PORT: gatewayPort } }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit', env: { ...process.env, GATEWAY_PORT: gatewayPort } }),
];
const stop = () => { procs.forEach((p) => p.kill('SIGTERM')); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => { if (code) { console.error('A dev process exited with', code); stop(); } }));
