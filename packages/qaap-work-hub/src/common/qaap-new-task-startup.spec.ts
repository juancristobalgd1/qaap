// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    beginNewTaskStartup,
    endNewTaskStartup,
    requestStopNewTaskStartup,
    conversationHasAgentOutput,
    resolveNewTaskStartupOutcome,
} from './qaap-new-task-startup';

describe('qaap-new-task-startup', () => {

    it('records a Stop that arrives while the project task is being created', () => {
        const startup = beginNewTaskStartup('project-a');
        expect(requestStopNewTaskStartup('project-a')).to.equal(true);
        expect(startup.stopRequested).to.equal(true);
        endNewTaskStartup(startup);
    });

    it('reports no in-flight creation once it has ended', () => {
        const startup = beginNewTaskStartup('project-a');
        endNewTaskStartup(startup);
        expect(requestStopNewTaskStartup('project-a')).to.equal(false);
    });

    it('does not let an ended creation clear a newer one for the same project', () => {
        const older = beginNewTaskStartup('project-a');
        const newer = beginNewTaskStartup('project-a');
        endNewTaskStartup(older);
        expect(requestStopNewTaskStartup('project-a')).to.equal(true);
        expect(newer.stopRequested).to.equal(true);
        endNewTaskStartup(newer);
    });

    it('cancels the created conversation and restores the draft when Stop arrived before creation resolved', () => {
        const startup = beginNewTaskStartup('project-a');
        requestStopNewTaskStartup('project-a');
        expect(resolveNewTaskStartupOutcome(startup, { id: 'task-new' })).to.equal('cancelAndRestore');
        endNewTaskStartup(startup);
    });

    it('restores the draft without cancelling when creation returned nothing and Stop arrived', () => {
        const startup = beginNewTaskStartup('project-a');
        requestStopNewTaskStartup('project-a');
        expect(resolveNewTaskStartupOutcome(startup, undefined)).to.equal('restore');
        endNewTaskStartup(startup);
    });

    it('commits the send when creation resolved and nothing stopped it', () => {
        const startup = beginNewTaskStartup('project-a');
        expect(resolveNewTaskStartupOutcome(startup, { id: 'task-new' })).to.equal('commit');
        endNewTaskStartup(startup);
    });

    it('counts agent text, tool segments or trace events as output; user messages alone are not', () => {
        expect(conversationHasAgentOutput({ messages: [{ role: 'user', content: 'hi' } as never] })).to.equal(false);
        expect(conversationHasAgentOutput({ messages: [{ role: 'agent', content: '  ' } as never] })).to.equal(false);
        expect(conversationHasAgentOutput({ messages: [{ role: 'agent', content: 'done' } as never] })).to.equal(true);
        expect(conversationHasAgentOutput({ messages: [{ role: 'agent', content: '', segments: [{}] } as never] })).to.equal(true);
        expect(conversationHasAgentOutput({ messages: [{ role: 'agent', content: '', traceEvents: [{}] } as never] })).to.equal(true);
    });
});
