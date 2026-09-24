// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    resolveThinkingOrbPaused,
    resolveThinkingOrbPhase,
    resolveThinkingOrbState,
    resolveThinkingOrbStateFromActivity,
} from './qaap-thinking-orb-phase';

describe('qaap-thinking-orb-phase', () => {
    it('maps product phases onto thinking-orbs states', () => {
        expect(resolveThinkingOrbState('listening')).to.equal('listening');
        expect(resolveThinkingOrbState('thinking')).to.equal('solving');
        expect(resolveThinkingOrbState('searching')).to.equal('searching');
        expect(resolveThinkingOrbState('working')).to.equal('working');
        expect(resolveThinkingOrbState('composing')).to.equal('composing');
        expect(resolveThinkingOrbState('shaping')).to.equal('shaping');
        expect(resolveThinkingOrbState('stalled')).to.equal('solving');
        expect(resolveThinkingOrbState('error')).to.equal('solving');
    });

    it('prefers error / stall / cancel over activity verbs', () => {
        expect(resolveThinkingOrbPhase({ isError: true, activityVerb: 'Read' })).to.equal('error');
        expect(resolveThinkingOrbPhase({ timedOut: true, activityKind: 'reading' })).to.equal('error');
        expect(resolveThinkingOrbPhase({ stalled: true, activityVerb: 'Run' })).to.equal('stalled');
        expect(resolveThinkingOrbPhase({ isCancelled: true, activityVerb: 'Write' })).to.equal('listening');
    });

    it('maps setup and streaming kinds', () => {
        expect(resolveThinkingOrbPhase({ setup: true })).to.equal('listening');
        expect(resolveThinkingOrbPhase({ activityKind: 'planning' })).to.equal('thinking');
        expect(resolveThinkingOrbPhase({ activityKind: 'reading' })).to.equal('searching');
        expect(resolveThinkingOrbPhase({ activityKind: 'terminal' })).to.equal('working');
        expect(resolveThinkingOrbPhase({ activityKind: 'editing' })).to.equal('shaping');
        expect(resolveThinkingOrbPhase({ activityKind: 'writing' })).to.equal('composing');
    });

    it('maps process-accordion activity verbs', () => {
        expect(resolveThinkingOrbStateFromActivity({ activityVerb: 'Read', isWorking: true })).to.equal('searching');
        expect(resolveThinkingOrbStateFromActivity({ activityVerb: 'Explore', isWorking: true })).to.equal('searching');
        expect(resolveThinkingOrbStateFromActivity({ activityVerb: 'Run', isWorking: true })).to.equal('working');
        expect(resolveThinkingOrbStateFromActivity({ activityVerb: 'Update', isWorking: true })).to.equal('shaping');
        expect(resolveThinkingOrbStateFromActivity({ activityVerb: 'Write', isWorking: true })).to.equal('shaping');
        expect(resolveThinkingOrbStateFromActivity({ activityKind: 'writing', isWorking: true })).to.equal('composing');
        expect(resolveThinkingOrbStateFromActivity({ isWorking: true })).to.equal('working');
    });

    it('pauses cancelled and stalled orbs', () => {
        expect(resolveThinkingOrbPaused({ isCancelled: true })).to.equal(true);
        expect(resolveThinkingOrbPaused({ stalled: true })).to.equal(true);
        expect(resolveThinkingOrbPaused({ isError: true })).to.equal(false);
        expect(resolveThinkingOrbPaused({ isWorking: true })).to.equal(false);
    });
});
