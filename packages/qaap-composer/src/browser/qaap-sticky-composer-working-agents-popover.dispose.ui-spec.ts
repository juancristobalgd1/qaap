// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type { WorkHubTeamMember } from '@theia/qaap-shared-core/lib/common/qaap-work-hub-team';
import {
    WORKING_CONTROL_CLASS,
    WORKING_EXPAND_CLIP_CLASS,
    clearWorkingPillStopAllSuppression,
    closeWorkingAgentsPopover,
    isWorkingAgentsExpandSessionOpen,
    openWorkingAgentsPopover,
} from './qaap-sticky-composer-working-agents-popover';

/**
 * `openWorkingAgentsPopover` is a module-level (non-class) widget: its "dispose" is
 * `closeWorkingAgentsPopover()`. Cleanup is wired through an `AbortController` (see
 * `wireWorkingAgentsExpandDismiss`), which removes the document `pointerdown` /
 * `keydown` listeners without going through a patchable `removeEventListener` call —
 * so leak coverage here is behavioral: after close, dispatching the same events must
 * no longer reach the (now torn-down) handlers.
 */
describe('qaap-sticky-composer-working-agents-popover (dispose/leak)', () => {
    let disableJSDOM: () => void;

    before(() => {
        disableJSDOM = enableJSDOM();
        // Node's AbortSignal is incompatible with jsdom addEventListener({ signal }).
        globalThis.AbortController = window.AbortController;
        window.requestAnimationFrame = callback => {
            callback(0);
            return 1;
        };
        window.cancelAnimationFrame = () => undefined;
        if (typeof window.PointerEvent === 'undefined') {
            class PointerEventPolyfill extends window.MouseEvent {
                constructor(type: string, params: MouseEventInit = {}) {
                    super(type, params);
                }
            }
            (window as typeof window & { PointerEvent: typeof PointerEvent }).PointerEvent =
                PointerEventPolyfill as unknown as typeof PointerEvent;
        }
    });

    after(() => {
        disableJSDOM();
    });

    beforeEach(() => {
        closeWorkingAgentsPopover(true);
        clearWorkingPillStopAllSuppression();
        document.body.replaceChildren();
    });

    afterEach(() => {
        closeWorkingAgentsPopover(true);
        clearWorkingPillStopAllSuppression();
        document.body.replaceChildren();
    });

    function member(partial: Partial<WorkHubTeamMember> & Pick<WorkHubTeamMember, 'id' | 'title'>): WorkHubTeamMember {
        return {
            kind: 'conversation',
            projectName: 'Demo',
            cwd: '/srv/demo',
            agentId: 'qaiq',
            state: 'streaming',
            childCount: 0,
            createdAt: 1,
            updatedAt: 2,
            conversationId: partial.id,
            ...partial,
        };
    }

    function mountAnchor(): HTMLButtonElement {
        const row = document.createElement('div');
        row.className = 'theia-mobile-sticky-composer-changes-pill-row';
        const pill = document.createElement('button');
        pill.className = 'theia-mobile-sticky-composer-working-pill';
        row.append(pill);
        document.body.append(row);
        return pill;
    }

    it('stops reacting to document pointerdown/keydown once closed (immediate)', () => {
        const anchor = mountAnchor();
        let closeCount = 0;
        openWorkingAgentsPopover({
            anchor,
            members: [member({ id: 'a', title: 'Task A' })],
            onSelect: () => undefined,
            onStopAll: () => undefined,
            onClose: () => { closeCount++; },
        });
        expect(isWorkingAgentsExpandSessionOpen()).to.equal(true);

        // While open, Escape reaches the document-level dismiss listener.
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        expect(closeCount).to.equal(1);

        closeWorkingAgentsPopover(true);
        expect(isWorkingAgentsExpandSessionOpen()).to.equal(false);

        // After close, the same event must no longer reach any handler (AbortController
        // cleanup actually detached the listeners rather than merely flipping a flag).
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        expect(closeCount, 'onClose must not fire again after teardown').to.equal(1);

        document.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
        expect(closeCount, 'outside pointerdown must not fire after teardown').to.equal(1);
    });

    it('removes the expand shell from the DOM on immediate close', () => {
        const anchor = mountAnchor();
        openWorkingAgentsPopover({
            anchor,
            members: [member({ id: 'a', title: 'Task A' })],
            onSelect: () => undefined,
            onStopAll: () => undefined,
        });
        expect(document.querySelector(`.${WORKING_EXPAND_CLIP_CLASS}`)).to.not.equal(null);

        closeWorkingAgentsPopover(true);
        expect(document.querySelector(`.${WORKING_EXPAND_CLIP_CLASS}`)).to.equal(null);
        // The shell wrapper stays (it wraps the pill permanently), but is no longer expanded.
        expect(document.querySelector(`.${WORKING_CONTROL_CLASS}.theia-mod-expanded`)).to.equal(null);
    });

    it('does not throw when closed twice', () => {
        const anchor = mountAnchor();
        openWorkingAgentsPopover({
            anchor,
            members: [member({ id: 'a', title: 'Task A' })],
            onSelect: () => undefined,
            onStopAll: () => undefined,
        });

        expect(() => {
            closeWorkingAgentsPopover(true);
            closeWorkingAgentsPopover(true);
        }).to.not.throw();
    });

    it('the non-immediate close fallback timer still removes the clip (no dangling open panel)', () => {
        const anchor = mountAnchor();
        const originalSetTimeout = window.setTimeout;
        // Speed up the 420ms transitionend-fallback timer used when jsdom never fires
        // a real `transitionend` (no CSS transitions in the test environment).
        (window as unknown as { setTimeout: typeof window.setTimeout }).setTimeout = ((handler: TimerHandler): number => {
            if (typeof handler === 'function') {
                handler();
            }
            return 0;
        }) as typeof window.setTimeout;

        try {
            openWorkingAgentsPopover({
                anchor,
                members: [member({ id: 'a', title: 'Task A' })],
                onSelect: () => undefined,
                onStopAll: () => undefined,
            });
            expect(document.querySelector(`.${WORKING_EXPAND_CLIP_CLASS}`)).to.not.equal(null);

            closeWorkingAgentsPopover(false);
            expect(document.querySelector(`.${WORKING_EXPAND_CLIP_CLASS}`), 'fallback timer should have removed the clip').to.equal(null);
        } finally {
            window.setTimeout = originalSetTimeout;
        }
    });
});
