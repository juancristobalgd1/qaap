// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapAgentStorageHealthCheck } from './qaap-agent-storage-health-check';

describe('QaapAgentStorageHealthCheck', () => {
    function check(recovery: 'loading' | 'ready' | 'failed', writeFailed: boolean): boolean {
        const instance = new QaapAgentStorageHealthCheck();
        Object.assign(instance, { runner: { storageHealth: () => ({ ready: recovery === 'ready' && !writeFailed, recovery, writeFailed }) } });
        return instance.check().healthy;
    }

    it('is healthy when ready, and while the index is still loading', () => {
        expect(check('ready', false)).to.equal(true);
        expect(check('loading', false)).to.equal(true);
    });

    it('is unhealthy when the restore failed or the last write failed', () => {
        expect(check('failed', false)).to.equal(false);
        expect(check('ready', true)).to.equal(false);
    });
});
