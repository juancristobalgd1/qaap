// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { rememberQaapDefaultAgentIdConfig } from '@theia/qaap-adapters/lib/common/qaap-default-agent-config';
import { getQaapDefaultAgentId, resolveQaapDefaultAgentId } from './qaap-default-agent-id';

describe('qaap-default-agent-id', () => {
    afterEach(() => rememberQaapDefaultAgentIdConfig(undefined));

    it('defaults to qaiq when nothing is configured', () => {
        expect(resolveQaapDefaultAgentId(undefined)).to.equal('qaiq');
        expect(resolveQaapDefaultAgentId('')).to.equal('qaiq');
        expect(getQaapDefaultAgentId()).to.equal('qaiq');
    });

    it('accepts a known agent id, case and spaces insensitive', () => {
        expect(resolveQaapDefaultAgentId('pi')).to.equal('pi');
        expect(resolveQaapDefaultAgentId('  Codex ')).to.equal('codex');
        expect(resolveQaapDefaultAgentId('qaiq')).to.equal('qaiq');
    });

    it('falls back to qaiq for an unknown or retired agent id', () => {
        expect(resolveQaapDefaultAgentId('no-such-agent')).to.equal('qaiq');
        expect(resolveQaapDefaultAgentId('openclaude')).to.equal('qaiq');
    });

    it('uses the id the backend announced to the frontend', () => {
        rememberQaapDefaultAgentIdConfig('pi');
        expect(getQaapDefaultAgentId()).to.equal('pi');
        rememberQaapDefaultAgentIdConfig('bogus');
        expect(getQaapDefaultAgentId()).to.equal('qaiq');
    });
});
