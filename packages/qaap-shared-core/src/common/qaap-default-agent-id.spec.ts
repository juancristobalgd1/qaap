// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { rememberQaapDefaultAgentIdConfig } from '@theia/qaap-adapters/lib/common/qaap-default-agent-config';
import { getQaapDefaultAgentId, resolveQaapDefaultAgentId } from './qaap-default-agent-id';

describe('qaap-default-agent-id', () => {
    afterEach(() => rememberQaapDefaultAgentIdConfig(undefined));

    it('has no default when nothing is configured (first available harness wins)', () => {
        expect(resolveQaapDefaultAgentId(undefined)).to.be.undefined;
        expect(resolveQaapDefaultAgentId('')).to.be.undefined;
        expect(getQaapDefaultAgentId()).to.be.undefined;
    });

    it('accepts a known agent id, case and spaces insensitive', () => {
        expect(resolveQaapDefaultAgentId('pi')).to.equal('pi');
        expect(resolveQaapDefaultAgentId('  Codex ')).to.equal('codex');
    });

    it('ignores an unknown, retired or hidden agent id, including qaiq', () => {
        expect(resolveQaapDefaultAgentId('no-such-agent')).to.be.undefined;
        expect(resolveQaapDefaultAgentId('openclaude')).to.be.undefined;
        expect(resolveQaapDefaultAgentId('qaiq')).to.be.undefined;
    });

    it('uses the id the backend announced to the frontend', () => {
        rememberQaapDefaultAgentIdConfig('pi');
        expect(getQaapDefaultAgentId()).to.equal('pi');
        rememberQaapDefaultAgentIdConfig('qaiq');
        expect(getQaapDefaultAgentId()).to.be.undefined;
    });
});
