// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type { QaapAgentMessageSegmentDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { buildMobileExecutionEvents } from './mobile-execution-event-builder';
import { createMobileToolGroupElement, mobileToolGroupStateLabel, syncMobileNarrativeToggle } from './mobile-execution-event-renderer';

describe('mobile tool group disclosure', () => {
    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    function firstEvent(finished: boolean, isError = false): ReturnType<typeof buildMobileExecutionEvents>['events'][number] {
        const timeline = buildMobileExecutionEvents([toolSegment('Read', 'disclosure-tool-1', JSON.stringify({ path: 'a.ts' }), finished, isError)]);
        return timeline.events[0]!;
    }

    it('exposes the summary as a button whose aria-expanded follows the open state', () => {
        const group = createMobileToolGroupElement(firstEvent(true)) as HTMLDetailsElement;
        const summary = group.querySelector<HTMLElement>(':scope > summary')!;
        expect(summary.getAttribute('role')).to.equal('button');
        expect(summary.getAttribute('aria-expanded')).to.equal('false');

        group.open = true;
        group.dispatchEvent(new group.ownerDocument.defaultView!.Event('toggle'));
        expect(summary.getAttribute('aria-expanded')).to.equal('true');

        group.open = false;
        group.dispatchEvent(new group.ownerDocument.defaultView!.Event('toggle'));
        expect(summary.getAttribute('aria-expanded')).to.equal('false');
    });

    it('labels the state icon with a localized status name', () => {
        const completed = createMobileToolGroupElement(firstEvent(true));
        const state = completed.querySelector<HTMLElement>('.theia-mobile-tool-group-state')!;
        expect(state.getAttribute('aria-label')).to.equal('Completed');
        expect(state.title).to.equal('Completed');

        const failed = createMobileToolGroupElement(firstEvent(true, true));
        expect(failed.querySelector<HTMLElement>('.theia-mobile-tool-group-state')!.getAttribute('aria-label')).to.equal('Failed');

        const running = createMobileToolGroupElement(firstEvent(false));
        expect(running.querySelector<HTMLElement>('.theia-mobile-tool-group-state')!.getAttribute('aria-label')).to.equal('Running');
    });

    it('maps the group flags to the state label', () => {
        expect(mobileToolGroupStateLabel({ hasError: true, hasPending: true })).to.equal('Failed');
        expect(mobileToolGroupStateLabel({ hasError: false, hasPending: true })).to.equal('Running');
        expect(mobileToolGroupStateLabel({ hasError: false, hasPending: false })).to.equal('Completed');
    });

    it('clamps long agent narratives behind a Show more toggle with aria-expanded', () => {
        const host = document.createElement('section');
        const narrative = document.createElement('p');
        narrative.className = 'theia-mobile-execution-event-narrative theia-mod-agent';
        narrative.textContent = '1. first step\n2. second step\n3. third step\n4. fourth step';
        host.append(narrative);
        syncMobileNarrativeToggle(narrative);
        const toggle = narrative.nextElementSibling as HTMLButtonElement;
        expect(narrative.classList.contains('theia-mod-clamped')).to.equal(true);
        expect(toggle.textContent).to.equal('Show more');
        expect(toggle.getAttribute('aria-expanded')).to.equal('false');

        toggle.click();
        expect(narrative.classList.contains('theia-mod-expanded')).to.equal(true);
        expect(toggle.getAttribute('aria-expanded')).to.equal('true');
        expect(toggle.textContent).to.equal('Show less');
    });

    it('adds no toggle for a short narrative', () => {
        const host = document.createElement('section');
        const narrative = document.createElement('p');
        narrative.className = 'theia-mobile-execution-event-narrative theia-mod-agent';
        narrative.textContent = 'Short note.';
        host.append(narrative);
        syncMobileNarrativeToggle(narrative);
        expect(narrative.nextElementSibling).to.equal(null);
        expect(narrative.classList.contains('theia-mod-clamped')).to.equal(false);
    });

    it('keeps a visible focus ring on the disclosure summary', () => {
        const css = fs.readFileSync(
            path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'mobile-workbench-transcript.css'),
            'utf8',
        );
        expect(css).to.match(/\.theia-mobile-tool-group-summary:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--theia-focusBorder\)/s);
        expect(css).to.not.include('.theia-mobile-tool-group-summary:focus,\n.theia-mobile-tool-group-summary:focus-visible,');
    });
});

function toolSegment(
    name: string,
    toolUseId: string,
    args: string,
    finished = true,
    isError = false,
    result = 'ok',
): Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }> {
    return {
        type: 'tool',
        name,
        toolUseId,
        args,
        finished,
        result: isError ? `<tool_use_error>${result}</tool_use_error>` : result,
    } as Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>;
}
