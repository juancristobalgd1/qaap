// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const mobileWorkflow = fs.readFileSync(path.join(root, '.github/workflows/qaap-mobile-playwright.yml'), 'utf8');
const guardsWorkflow = fs.readFileSync(path.join(root, '.github/workflows/qaap-guards.yml'), 'utf8');
const mobileConfig = fs.readFileSync(path.join(root, 'examples/playwright/configs/playwright.qaap-mobile-required.config.ts'), 'utf8');
const mobileSmoke = fs.readFileSync(path.join(root, 'examples/playwright/src/tests/qaap-required-mobile/required-mobile-smoke.ui-spec.ts'), 'utf8');

test('mobile Playwright workflow has no path filters and keeps its full mobile suite setup', () => {
    assert.doesNotMatch(mobileWorkflow, /^\s+paths(?:-ignore)?:/m);
    assert.match(mobileWorkflow, /name: Qaap Mobile Playwright/);
    assert.match(mobileWorkflow, /name: Prepare mobile E2E fixtures and agent/);
    assert.match(mobileWorkflow, /npm run ui-tests:qaap-mobile/);
    assert.match(mobileWorkflow, /Archive test results/);
});

test('the existing required qaap-guards check runs the mobile E2E smoke without a grep filter', () => {
    assert.match(guardsWorkflow, /name: Qaap guards/);
    assert.match(guardsWorkflow, /name: qaap-guards/);
    const start = guardsWorkflow.indexOf('- name: Required mobile E2E smoke (unfiltered)');
    assert.notEqual(start, -1);
    const nextStep = guardsWorkflow.indexOf('\n      - name:', start + 1);
    const smokeStep = guardsWorkflow.slice(start, nextStep === -1 ? undefined : nextStep);
    assert.match(smokeStep, /playwright test --config=\.\/configs\/playwright\.qaap-mobile-required\.config\.ts/);
    assert.doesNotMatch(smokeStep, /--grep/);
    assert.match(guardsWorkflow, /Archive required mobile E2E results/);
});

test('the required mobile config runs the dedicated smoke directory without grep filters', () => {
    assert.match(mobileConfig, /testDir: '\.\.\/lib\/tests\/qaap-required-mobile'/);
    assert.doesNotMatch(mobileConfig, /grep(?:Invert)?:/);
    assert.match(mobileSmoke, /theia-mod-mobile-one-column/);
    assert.match(mobileSmoke, /theia-mobile-projects-sticky-composer-input/);
    assert.doesNotMatch(mobileSmoke, /waitForTimeout|setTimeout|sleep\(/);
});
