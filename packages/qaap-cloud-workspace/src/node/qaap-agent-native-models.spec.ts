// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listStaticNativeAgentModels } from '../common/qaap-agent-native-model-catalog';
import { clearNativeAgentModelCache, listNativeAgentModels, prepareNativeAgentModels } from './qaap-agent-native-models';

describe('qaap-agent-native-models', () => {
    let sandbox: string;
    let originalPath: string | undefined;

    beforeEach(() => {
        clearNativeAgentModelCache();
        sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-native-models-'));
        originalPath = process.env.PATH;
    });

    afterEach(() => {
        process.env.PATH = originalPath;
        clearNativeAgentModelCache();
        fs.rmSync(sandbox, { recursive: true, force: true });
    });

    it('answers a cold catalog without waiting for a slow CLI, then caches the discovered list', async function (): Promise<void> {
        if (process.platform === 'win32') {
            this.skip();
        }
        // A CLI that takes far longer than any request may block the event loop.
        fs.writeFileSync(path.join(sandbox, 'cursor-agent'), '#!/bin/sh\nsleep 1\necho auto\necho cursor-private-model\n', { mode: 0o755 });
        process.env.PATH = `${sandbox}${path.delimiter}${originalPath ?? ''}`;

        const startedAt = Date.now();
        const cold = listNativeAgentModels('cursor');
        expect(Date.now() - startedAt).to.be.lessThan(500);
        expect(cold).to.deep.equal(listStaticNativeAgentModels('cursor'));

        const discovered = await prepareNativeAgentModels('cursor');
        expect(discovered.map(model => model.modelId)).to.deep.equal(['auto', 'cursor-private-model']);
        expect(listNativeAgentModels('cursor').map(model => model.modelId)).to.deep.equal(['auto', 'cursor-private-model']);
    });

    it('falls back to the curated catalog when the CLI is missing', async () => {
        process.env.PATH = sandbox;
        expect(await prepareNativeAgentModels('cursor')).to.deep.equal(listStaticNativeAgentModels('cursor'));
    });
});
