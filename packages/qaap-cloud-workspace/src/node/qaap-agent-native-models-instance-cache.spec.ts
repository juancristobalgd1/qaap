// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listStaticNativeAgentModels } from '../common/qaap-agent-native-model-catalog';
import {
    clearNativeAgentModelCache,
    invalidateNativeAgentModels,
    listNativeAgentModels,
    prepareNativeAgentModels,
    setNativeModelCatalogStoreDirForTests,
} from './qaap-agent-native-models';

describe('qaap-agent-native-models per harness instance cache', () => {
    let sandbox: string;
    let originalPath: string | undefined;

    beforeEach(() => {
        sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-native-instance-'));
        // Persisted catalogs must never reach the real ~/.qaap from a test.
        setNativeModelCatalogStoreDirForTests(path.join(sandbox, 'store'));
        clearNativeAgentModelCache();
        originalPath = process.env.PATH;
        fs.writeFileSync(path.join(sandbox, 'cursor-agent'), '#!/bin/sh\necho auto\necho cursor-private-model\n', { mode: 0o755 });
        process.env.PATH = `${sandbox}${path.delimiter}${originalPath ?? ''}`;
    });

    afterEach(() => {
        process.env.PATH = originalPath;
        clearNativeAgentModelCache();
        fs.rmSync(sandbox, { recursive: true, force: true });
    });

    it('keeps an instance catalog apart from the base catalog', async function (): Promise<void> {
        if (process.platform === 'win32') {
            this.skip();
        }
        await prepareNativeAgentModels('cursor');
        expect(listNativeAgentModels('cursor').map(model => model.modelId)).to.deep.equal(['auto', 'cursor-private-model']);
        // The instance has its own (cold) entry: it does not read the base's discovered list.
        expect(listNativeAgentModels('cursor#2')).to.deep.equal(listStaticNativeAgentModels('cursor'));
    });

    it('invalidating an instance leaves the base catalog cached', async function (): Promise<void> {
        if (process.platform === 'win32') {
            this.skip();
        }
        await prepareNativeAgentModels('cursor');
        invalidateNativeAgentModels('cursor#2');
        expect(listNativeAgentModels('cursor').map(model => model.modelId)).to.deep.equal(['auto', 'cursor-private-model']);
    });

    it('never runs the base binary for an instance that has no spawner of its own', async function (): Promise<void> {
        if (process.platform === 'win32') {
            this.skip();
        }
        const discovered = await prepareNativeAgentModels('cursor#2');
        expect(discovered).to.deep.equal(listStaticNativeAgentModels('cursor'));
        expect(listNativeAgentModels('cursor#2')).to.deep.equal(listStaticNativeAgentModels('cursor'));
    });

    it('invalidating the base leaves an instance catalog it did not reach', async function (): Promise<void> {
        if (process.platform === 'win32') {
            this.skip();
        }
        // The instance discovers with its own spawner (the runner's instance spawner in production).
        const spawner = (_bin: string, args: readonly string[]) => ({ file: path.join(sandbox, 'cursor-agent'), args: [...args], env: { PATH: sandbox } });
        await prepareNativeAgentModels('cursor#2', { spawner });
        invalidateNativeAgentModels('cursor');
        expect(listNativeAgentModels('cursor#2').map(model => model.modelId)).to.deep.equal(['auto', 'cursor-private-model']);
    });
});
