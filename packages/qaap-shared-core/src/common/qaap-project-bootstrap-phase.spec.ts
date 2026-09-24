// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { normalizePersistedBootstrapPhase } from './qaap-project-bootstrap-phase';

describe('qaap-project-bootstrap-phase', () => {

    it('normalizePersistedBootstrapPhase upgrades detected to ready-to-run when node_modules exists', () => {
        expect(normalizePersistedBootstrapPhase('detected', true)).to.equal('ready-to-run');
        expect(normalizePersistedBootstrapPhase('installing', true)).to.equal('ready-to-run');
        expect(normalizePersistedBootstrapPhase('detected', false)).to.equal('detected');
    });

    it('normalizePersistedBootstrapPhase preserves terminal failure and dismissed phases', () => {
        expect(normalizePersistedBootstrapPhase('install-failed', true)).to.equal('install-failed');
        expect(normalizePersistedBootstrapPhase('run-failed', true)).to.equal('run-failed');
        expect(normalizePersistedBootstrapPhase('dismissed', false)).to.equal('dismissed');
        expect(normalizePersistedBootstrapPhase('ready-to-run', false)).to.equal('ready-to-run');
    });
});
