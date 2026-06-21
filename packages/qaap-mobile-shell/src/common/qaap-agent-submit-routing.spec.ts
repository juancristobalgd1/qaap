// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    resolveAgentSubmitSurface,
    shouldRouteSubmitToTheiaCoder,
    shouldRouteSubmitToVpsBackground,
} from './qaap-agent-submit-routing';
import { QAIQ_AGENT_ID, THEIA_CODER_AGENT_ID } from './qaap-agent-task-client';

describe('qaap-agent-submit-routing', () => {

    it('defaults Work Hub submits to VPS background', () => {
        expect(resolveAgentSubmitSurface({ draft: 'fix the tests' })).to.equal('vps-background');
        expect(shouldRouteSubmitToVpsBackground({ draft: 'fix the tests' })).to.equal(true);
    });

    it('routes @qaiq and other VPS mentions to background', () => {
        expect(resolveAgentSubmitSurface({ draft: `@${QAIQ_AGENT_ID} refactor auth` }))
            .to.equal('vps-background');
        expect(resolveAgentSubmitSurface({ draft: '@codex run lint' }))
            .to.equal('vps-background');
    });

    it('routes explicit Coder selection or @Coder mention to Theia Coder', () => {
        expect(resolveAgentSubmitSurface({
            draft: 'explain this file',
            selectedAgentId: THEIA_CODER_AGENT_ID,
        })).to.equal('theia-coder');
        expect(resolveAgentSubmitSurface({ draft: '@Coder explain this file' }))
            .to.equal('theia-coder');
        expect(shouldRouteSubmitToTheiaCoder({ draft: '@Coder hi' })).to.equal(true);
    });

    it('forceVps and legacy theia-chat always use VPS even with Coder pinned', () => {
        expect(resolveAgentSubmitSurface({
            draft: 'continue',
            selectedAgentId: THEIA_CODER_AGENT_ID,
            forceVps: true,
        })).to.equal('vps-background');
        expect(resolveAgentSubmitSurface({
            draft: 'continue',
            selectedAgentId: THEIA_CODER_AGENT_ID,
            isLegacyTheiaChat: true,
        })).to.equal('vps-background');
    });

    it('VPS @mention beats an explicit Coder pin', () => {
        expect(resolveAgentSubmitSurface({
            draft: `@${QAIQ_AGENT_ID} ship it`,
            selectedAgentId: THEIA_CODER_AGENT_ID,
        })).to.equal('vps-background');
    });
});
