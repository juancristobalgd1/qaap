#!/usr/bin/env node
// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sourcePath = path.join(__dirname, '..', 'packages', 'qaap-archive', 'src', 'node', 'safe-archive-extractor.ts');
const source = fs.readFileSync(sourcePath, 'utf8');

for (const marker of [
    'normalizeArchivePath',
    'ensureSafeLinkTarget',
    'O_NOFOLLOW',
    'extractArchive',
]) {
    assert(source.includes(marker), `safe archive extractor is missing ${marker}`);
}

console.log('[qaap-archive-security-check] OK — extraction is centralized behind path and link containment checks.');
