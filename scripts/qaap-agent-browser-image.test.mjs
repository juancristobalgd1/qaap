import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const dockerfile = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const smokeCheck = fs.readFileSync(new URL('./qaap-image-runtime-check.js', import.meta.url), 'utf8');

test('runtime image pins Playwright MCP and installs it beside Chromium', () => {
    assert.match(dockerfile, /^ARG PLAYWRIGHT_MCP_VERSION=\d+\.\d+\.\d+$/m);
    assert.match(dockerfile, /@playwright\/mcp@"\$\{PLAYWRIGHT_MCP_VERSION\}"/);
    assert.match(dockerfile, /playwright-mcp --help/);
    assert.match(dockerfile, /chromium --version/);
    assert.match(smokeCheck, /spawnSync\('playwright-mcp', \['--help'\]/);
    assert.match(smokeCheck, /existsSync\('\/usr\/bin\/chromium'\)/);
});
