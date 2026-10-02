// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type { QaapAgentCliUpdateInfo, QaapAgentCliUpdateResult } from '../common/qaap-agent-cli-update';

describe('QaapAgentCliUpdateContribution update action', () => {
    let disableJSDOM: (() => void) | undefined;
    let contributionModule: typeof import('./qaap-agent-cli-update-contribution');

    before(() => {
        disableJSDOM = enableJSDOM();
        contributionModule = require('./qaap-agent-cli-update-contribution');
    });

    after(() => disableJSDOM?.());

    it('shows the backend reason and resets the toast so the user can retry', async () => {
        const contribution = Object.create(contributionModule.QaapAgentCliUpdateContribution.prototype) as Record<string, unknown>;
        const updating: boolean[] = [];
        const failures: string[] = [];
        let requestedId: string | undefined;
        const result: QaapAgentCliUpdateResult = { ok: false, id: 'codex', message: 'EACCES: permission denied' };
        Object.assign(contribution, {
            disposed: false,
            toast: {
                root: document.createElement('div'),
                setUpdating: (value: boolean) => { updating.push(value); },
                dispose: () => undefined,
            },
            requestUpdate: async (request: QaapAgentCliUpdateInfo) => {
                requestedId = request.id;
                return result;
            },
            showUpdateFailure: (_request: QaapAgentCliUpdateInfo, message: string) => { failures.push(message); },
        });
        const info: QaapAgentCliUpdateInfo = {
            id: 'codex',
            label: 'Codex',
            bin: 'codex',
            latestVersion: '1.1.0',
            updateAvailable: true,
            updateSupported: true,
        };

        await (contribution as unknown as { runUpdate(request: QaapAgentCliUpdateInfo): Promise<void> }).runUpdate(info);

        expect(requestedId).to.equal('codex');
        expect(failures).to.have.length(1);
        expect(failures[0]).to.contain('EACCES: permission denied');
        expect(updating).to.deep.equal([true, false]);
    });
});
