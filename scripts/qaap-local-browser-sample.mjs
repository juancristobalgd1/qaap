#!/usr/bin/env node
/**
 * Local Qaap browser dev: print sample-workspace URL and verify the backend is up.
 * Usage: npm run qaap:local:browser   (after npm run build:browser && npm run start:browser)
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sampleWorkspace = resolve(
    root,
    'examples/playwright/src/tests/resources/sample-files1',
);
const hashPath = sampleWorkspace.replace(/\\/g, '/');
const baseUrl = process.env.QAAP_BASE_URL ?? 'http://localhost:3000';
const openUrl = `${baseUrl}/#${hashPath}`;

if (!existsSync(sampleWorkspace)) {
    console.error(`Sample workspace missing: ${sampleWorkspace}`);
    process.exit(1);
}

let online = false;
try {
    const res = await fetch(baseUrl, { method: 'GET' });
    online = res.ok;
} catch {
    online = false;
}

console.log('');
console.log('Qaap local browser — sample workspace');
console.log('=====================================');
console.log(`Sample folder: ${sampleWorkspace}`);
console.log(`Open URL:      ${openUrl}`);
console.log('');
if (online) {
    console.log(`Backend OK at ${baseUrl}`);
} else {
    console.log(`Backend not reachable at ${baseUrl}`);
    console.log('Start it with: npm run start:browser');
}
console.log('');
console.log('Tips:');
console.log('- QAAP_SKIP_AUTH=true in examples/browser/.env skips login');
console.log('- In Agents: composer appears after a folder is open');
console.log('- Or use onboarding → "Open folder on this device"');
console.log('');
