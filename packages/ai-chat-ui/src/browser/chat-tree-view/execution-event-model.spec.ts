// *****************************************************************************
// Copyright (C) 2026 EclipseSource GmbH.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the
// Eclipse Public License v. 2.0 are satisfied: GNU General Public License,
// version 2 with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ChatResponseContent, ToolCallChatResponseContent } from '@theia/ai-chat';
import { expect } from 'chai';
import { buildExecutionEventTimeline, formatEventSummary } from './execution-event-model';

describe('buildExecutionEventTimeline', () => {

    it('groups consecutive tool calls of the same kind into one event', () => {
        const timeline = buildExecutionEventTimeline([
            toolCall('read_file'),
            toolCall('read_file'),
            toolCall('bash'),
        ]);

        expect(timeline.events).to.have.length(2);
        expect(timeline.events[0]?.kind).to.equal('read');
        expect(timeline.events[0]?.tools).to.have.length(2);
        expect(timeline.events[1]?.kind).to.equal('run');
        expect(timeline.events[1]?.tools).to.have.length(1);
    });

    it('uses agent narrative as the event narrative when available', () => {
        const narrative = textContent("I'm inspecting the repository.");
        const timeline = buildExecutionEventTimeline([
            narrative,
            toolCall('grep'),
            toolCall('grep'),
        ]);

        expect(timeline.events[0]?.narrative).to.equal("I'm inspecting the repository.");
        expect(timeline.events[0]?.narrativeSource).to.equal('agent');
    });

    it('generates synthetic narrative when no agent text precedes tools', () => {
        const timeline = buildExecutionEventTimeline([
            toolCall('grep'),
        ]);

        expect(timeline.events[0]?.narrativeSource).to.equal('synthetic');
        expect(timeline.events[0]?.narrative).to.not.equal('');
    });

    it('starts a new event when the tool kind changes', () => {
        const timeline = buildExecutionEventTimeline([
            toolCall('grep'),
            toolCall('bash'),
            toolCall('edit_file'),
        ]);

        expect(timeline.events).to.have.length(3);
        expect(timeline.events[0]?.kind).to.equal('explore');
        expect(timeline.events[1]?.kind).to.equal('run');
        expect(timeline.events[2]?.kind).to.equal('edit');
    });

    it('starts a new event when narrative appears between tools', () => {
        const narrative = textContent('I found the rendering pipeline.');
        const timeline = buildExecutionEventTimeline([
            toolCall('read_file'),
            narrative,
            toolCall('read_file'),
        ]);

        expect(timeline.events).to.have.length(2);
        expect(timeline.events[0]?.tools).to.have.length(1);
        expect(timeline.events[1]?.narrative).to.equal('I found the rendering pipeline.');
        expect(timeline.events[1]?.narrativeSource).to.equal('agent');
    });

    it('captures trailing text as closing narrative content', () => {
        const closing = textContent("I'm done with the implementation.");
        const timeline = buildExecutionEventTimeline([
            toolCall('read_file'),
            closing,
        ]);

        expect(timeline.closingNarrativeContents).to.deep.equal([closing]);
    });

    it('classifies verification commands (npm test, lint, typecheck) as verification events', () => {
        const timeline = buildExecutionEventTimeline([
            toolCall('bash', '{"command":"npm run test"}'),
            toolCall('shell_exec', '{"cmd":"pnpm lint"}'),
            toolCall('vitest'),
        ]);

        expect(timeline.events).to.have.length(1);
        expect(timeline.events[0]?.kind).to.equal('verification');
    });

    it('keeps generic shell commands as run events', () => {
        const timeline = buildExecutionEventTimeline([
            toolCall('bash', '{"command":"npm install"}'),
        ]);

        expect(timeline.events[0]?.kind).to.equal('run');
    });

    it('marks terminal tools (run/verification) as terminal', () => {
        const timeline = buildExecutionEventTimeline([
            toolCall('bash', '{"command":"echo hello"}'),
            toolCall('read_file'),
        ]);

        expect(timeline.events[0]?.tools[0]?.isTerminal).to.equal(true);
        expect(timeline.events[1]?.tools[0]?.isTerminal).to.equal(false);
    });

    it('propagates pending and error state to the event level', () => {
        const timeline = buildExecutionEventTimeline([
            toolCall('bash', undefined, false),
            toolCall('read_file', undefined, true, true),
        ]);

        // First event (run) has a pending tool
        expect(timeline.events[0]?.hasPending).to.equal(true);
        // Second event (read) has an errored tool
        expect(timeline.events[1]?.hasError).to.equal(true);
    });

    it('detects error results from tool calls', () => {
        const timeline = buildExecutionEventTimeline([
            toolCall('read_file', undefined, true, true),
        ]);
        expect(timeline.events[0]?.hasError).to.equal(true);
    });

    it('formatEventSummary produces count + noun', () => {
        const timeline = buildExecutionEventTimeline([
            toolCall('read_file'),
            toolCall('read_file'),
        ]);
        expect(formatEventSummary(timeline.events[0]!)).to.equal('2 files');
    });

    it('does not silently drop non-text, non-tool content with asString', () => {
        const composite = textContent('Composite content');
        const timeline = buildExecutionEventTimeline([
            composite,
            toolCall('read_file'),
        ]);

        // The composite content should become the narrative, not be dropped
        expect(timeline.events[0]?.narrative).to.equal('Composite content');
        expect(timeline.events[0]?.narrativeSource).to.equal('agent');
    });

    it('preserves the original ChatResponseContent object for rich rendering', () => {
        const narrative = textContent("I'm inspecting the repository.");
        const timeline = buildExecutionEventTimeline([
            narrative,
            toolCall('grep'),
        ]);

        // The narrativeContents should contain the original content object, so
        // renderers can render it as rich content (markdown, etc.)
        expect(timeline.events[0]?.narrativeContents).to.deep.equal([narrative]);
    });

    it('narrativeContents is undefined for synthetic narratives', () => {
        const timeline = buildExecutionEventTimeline([
            toolCall('grep'),
        ]);

        expect(timeline.events[0]?.narrativeSource).to.equal('synthetic');
        expect(timeline.events[0]?.narrativeContents).to.equal(undefined);
    });

    it('accumulates multiple consecutive text segments into one event narrative without dropping any', () => {
        const first = textContent('Let me explain the approach.');
        const second = textContent("I'll start by reading the file.");
        const timeline = buildExecutionEventTimeline([
            first,
            second,
            toolCall('read_file'),
        ]);

        expect(timeline.events).to.have.length(1);
        expect(timeline.events[0]?.narrativeSource).to.equal('agent');
        // Both segments should appear in the joined narrative text
        expect(timeline.events[0]?.narrative).to.include('Let me explain the approach.');
        expect(timeline.events[0]?.narrative).to.include("I'll start by reading the file.");
        // Both original content objects should be preserved for rich rendering
        expect(timeline.events[0]?.narrativeContents).to.deep.equal([first, second]);
    });

    it('accumulates multiple trailing text segments as closing narrative without dropping any', () => {
        const first = textContent('Done with the implementation.');
        const second = textContent("Here's a summary of changes.");
        const timeline = buildExecutionEventTimeline([
            toolCall('read_file'),
            first,
            second,
        ]);

        expect(timeline.closingNarrative).to.include('Done with the implementation.');
        expect(timeline.closingNarrative).to.include("Here's a summary of changes.");
        expect(timeline.closingNarrativeContents).to.deep.equal([first, second]);
    });

    it('accumulates text segments between tool groups as narrative for the next event', () => {
        const first = textContent('I found the rendering pipeline.');
        const second = textContent('Now let me check the tests.');
        const timeline = buildExecutionEventTimeline([
            toolCall('read_file'),
            first,
            second,
            toolCall('read_file'),
        ]);

        expect(timeline.events).to.have.length(2);
        expect(timeline.events[1]?.narrativeSource).to.equal('agent');
        expect(timeline.events[1]?.narrative).to.include('I found the rendering pipeline.');
        expect(timeline.events[1]?.narrative).to.include('Now let me check the tests.');
        expect(timeline.events[1]?.narrativeContents).to.deep.equal([first, second]);
    });

    it('preserves error content (no asString text) as narrative for the next event', () => {
        const error = errorContent('Something went wrong');
        const timeline = buildExecutionEventTimeline([
            error,
            toolCall('read_file'),
        ]);

        expect(timeline.events).to.have.length(1);
        expect(timeline.events[0]?.narrativeSource).to.equal('agent');
        // The error content object must be preserved for rich rendering
        expect(timeline.events[0]?.narrativeContents).to.deep.equal([error]);
    });

    it('preserves error content as closing narrative when it appears after all tools', () => {
        const error = errorContent('The agent failed');
        const timeline = buildExecutionEventTimeline([
            toolCall('read_file'),
            error,
        ]);

        // closingNarrativeContents must contain the error content object
        expect(timeline.closingNarrativeContents).to.deep.equal([error]);
        // closingNarrative plain text is undefined because error content has no
        // asString text — the renderer must use closingNarrativeContents
        expect(timeline.closingNarrative).to.equal(undefined);
    });

    it('preserves error content alongside text content in the same narrative', () => {
        const text = textContent('I tried to read the file.');
        const error = errorContent('File not found');
        const timeline = buildExecutionEventTimeline([
            text,
            error,
            toolCall('read_file'),
        ]);

        expect(timeline.events).to.have.length(1);
        expect(timeline.events[0]?.narrativeSource).to.equal('agent');
        // Both content objects preserved for rich rendering
        expect(timeline.events[0]?.narrativeContents).to.deep.equal([text, error]);
        // Plain-text narrative includes only the text entry, not the error
        expect(timeline.events[0]?.narrative).to.equal('I tried to read the file.');
    });

});

function toolCall(name: string, args?: string, finished = true, isError = false): ToolCallChatResponseContent {
    return {
        kind: 'toolCall',
        name,
        arguments: args,
        finished,
        result: isError ? { error: true } : { content: [] },
    } as unknown as ToolCallChatResponseContent;
}

function textContent(content: string): ChatResponseContent {
    return {
        kind: 'text',
        asString: () => content,
    } as ChatResponseContent;
}

function errorContent(message: string): ChatResponseContent {
    return {
        kind: 'error',
        error: new Error(message),
        asString: () => undefined,
    } as unknown as ChatResponseContent;
}
