// Copyright (C) 2026 Qaap contributors.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const retiredWorkflows = [
    'publish-ci.yml',
    'translation.yml',
    'generate-sbom.yml',
    'native-dependencies.yml',
    'discussion-welcome.yml',
    'publish-api-doc-gh-pages.yml',
];

const filesUnder = directory => fs.readdirSync(path.join(root, directory), { withFileTypes: true })
    .flatMap(entry => {
        const relativePath = path.join(directory, entry.name);
        return entry.isDirectory() ? filesUnder(relativePath) : [relativePath];
    });

test('retired Theia release workflows are absent', () => {
    for (const workflow of retiredWorkflows) {
        assert.equal(fs.existsSync(path.join(root, '.github', 'workflows', workflow)), false, workflow);
    }
});

test('remaining workflows and scripts do not reference retired workflow files', () => {
    const candidates = [...filesUnder('.github/workflows'), ...filesUnder('scripts')]
        .filter(file => file !== path.join('scripts', path.basename(__filename))
            && file !== path.join('scripts', 'qaap-drift-check.js'));

    for (const file of candidates) {
        const contents = fs.readFileSync(path.join(root, file), 'utf8');
        for (const workflow of retiredWorkflows) {
            assert.equal(contents.includes(workflow), false, `${file} references ${workflow}`);
        }
    }
});
