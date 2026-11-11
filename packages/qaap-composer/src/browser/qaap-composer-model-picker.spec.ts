// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { renderQaapComposerModelPicker, type QaapComposerModelPickerProps } from './qaap-composer-model-picker';
import { QaapComposerModelPickerModel, type QaapPickerState } from '../common/qaap-composer-model-picker-model';

function state(overrides: Partial<QaapPickerState> = {}): QaapPickerState {
    return {
        harnesses: [{ id: 'claude', label: 'Claude' }, { id: 'codex', label: 'Codex' }],
        models: [
            { agentId: 'claude', modelId: 'opus-4-6', label: 'Opus 4.6', available: true },
            { agentId: 'claude', modelId: 'sonnet-4-6', label: 'Sonnet 4.6', available: true },
            { agentId: 'claude', modelId: 'haiku-4-5', label: 'Haiku 4.5', available: false, unavailableReason: 'Requires a paid plan' },
        ],
        favorites: [],
        railSelection: 'claude',
        query: '',
        currentAgentId: 'claude',
        currentModelId: 'opus-4-6',
        ...overrides,
    };
}

function props(overrides: Partial<QaapComposerModelPickerProps> = {}): QaapComposerModelPickerProps {
    return {
        state: state(),
        effort: { support: { levels: ['low', 'medium', 'high'], defaultLevel: 'high' }, current: 'high' },
        approval: { current: 'approve-for-me' },
        onSelectModel: () => undefined,
        onSelectEffort: () => undefined,
        onSelectApproval: () => undefined,
        onToggleFavorite: () => undefined,
        onQuery: () => undefined,
        onRail: () => undefined,
        onClose: () => undefined,
        ...overrides,
    };
}

function rows(host: HTMLElement): HTMLButtonElement[] {
    return Array.from(host.querySelectorAll<HTMLButtonElement>('.qaap-model-picker-row'));
}

describe('qaap-composer-model-picker', () => {

    /** Waits for the next animation frame, which the edge-fade helper uses to sync classes. */
    const nextFrame = (): Promise<void> => new Promise<void>(resolve => window.setTimeout(resolve, 50));
    let host: HTMLElement;
    let disableJSDOM: () => void;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
        host = document.createElement('div');
        document.body.append(host);
    });

    afterEach(() => {
        host.remove();
        disableJSDOM();
    });

    it('paints the rail and the model list side by side, with no effort column', () => {
        renderQaapComposerModelPicker(host, props());
        expect(host.querySelector('.qaap-model-picker-body > .qaap-model-picker-rail-frame > .qaap-model-picker-rail')).to.not.equal(null);
        expect(host.querySelector('.qaap-model-picker-body > .qaap-model-picker-list')).to.not.equal(null);
        expect(host.querySelector('.qaap-model-picker-body .qaap-model-picker-effort')).to.equal(null);
        expect(rows(host).map(row => row.dataset.modelId)).to.deep.equal(['opus-4-6', 'sonnet-4-6', 'haiku-4-5']);
    });

    it('filters the rows by the query text', () => {
        renderQaapComposerModelPicker(host, props({ state: state({ query: 'sonnet' }) }));
        expect(rows(host).map(row => row.dataset.modelId)).to.deep.equal(['sonnet-4-6']);
    });

    it('selects the second row with Cmd+2', () => {
        const selected: string[] = [];
        renderQaapComposerModelPicker(host, props({ onSelectModel: (_agent, model) => selected.push(model) }));
        host.dispatchEvent(new KeyboardEvent('keydown', { key: '2', metaKey: true, bubbles: true, cancelable: true }));
        expect(selected).to.deep.equal(['sonnet-4-6']);
    });

    it('does not select an unavailable row and marks it with its reason', () => {
        const selected: string[] = [];
        renderQaapComposerModelPicker(host, props({ onSelectModel: (_agent, model) => selected.push(model) }));
        const haiku = rows(host)[2];
        expect(haiku.disabled).to.equal(true);
        expect(haiku.title).to.equal('Requires a paid plan');
        host.dispatchEvent(new KeyboardEvent('keydown', { key: '3', metaKey: true, bubbles: true, cancelable: true }));
        expect(selected).to.deep.equal([]);
    });

    it('shows the favorites rail with only starred models', () => {
        const favorites = [QaapComposerModelPickerModel.favoriteKey('claude', 'sonnet-4-6')];
        renderQaapComposerModelPicker(host, props({ state: state({ railSelection: 'favorites', favorites }) }));
        expect(rows(host).map(row => row.dataset.modelId)).to.deep.equal(['sonnet-4-6']);
    });

    it('hides the effort menu when the harness takes no effort', () => {
        renderQaapComposerModelPicker(host, props({ effort: { current: undefined } }));
        expect(host.querySelector('.qaap-model-picker-effort')).to.equal(null);
    });

    it('lists the effort levels in a footer menu and marks the current one', () => {
        renderQaapComposerModelPicker(host, props());
        const trigger = host.querySelector<HTMLButtonElement>('.qaap-model-picker-effort');
        expect(trigger?.textContent).to.contain('High');
        const items = Array.from(host.querySelectorAll<HTMLButtonElement>('.qaap-model-picker-effort-wrap .qaap-model-picker-access-option'));
        expect(items.map(item => item.textContent)).to.deep.equal(['Low', 'Medium', 'High']);
        expect(items.filter(item => item.getAttribute('aria-checked') === 'true')).to.have.length(1);
    });

    it('picks an effort level from the footer menu', () => {
        const picked: string[] = [];
        renderQaapComposerModelPicker(host, props({ onSelectEffort: level => picked.push(level) }));
        host.querySelector<HTMLButtonElement>('.qaap-model-picker-effort')?.click();
        const low = Array.from(host.querySelectorAll<HTMLButtonElement>('.qaap-model-picker-effort-wrap .qaap-model-picker-access-option'))
            .find(item => item.textContent === 'Low');
        low?.click();
        expect(picked).to.deep.equal(['low']);
    });

    it('shows no access note under any approval', () => {
        renderQaapComposerModelPicker(host, props({ approval: { current: 'request-approval' } }));
        expect(host.querySelector('.qaap-model-picker-access-note')).to.equal(null);
    });

    it('places the access control on the right of the footer', () => {
        renderQaapComposerModelPicker(host, props());
        expect(host.querySelector('.qaap-model-picker-footer-right .qaap-model-picker-access')).to.not.equal(null);
        expect(host.querySelector('.qaap-model-picker-footer-left .qaap-model-picker-effort')).to.not.equal(null);
    });

    it('closes once on Escape', () => {
        let closed = 0;
        renderQaapComposerModelPicker(host, props({ onClose: () => { closed++; } }));
        host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        expect(closed).to.equal(1);
    });

    it('scrolls a long harness rail: the end fade shows first, the start fade after scrolling, and the selection comes into view', async () => {
        const harnesses = Array.from({ length: 12 }, (_, index) => ({ id: `agent-${index}`, label: `Agent ${index}` }));
        const scrollTopDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop');
        const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
        const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
        const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
        const revealed: string[] = [];
        Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
            configurable: true,
            get(this: HTMLElement) { return (this as unknown as { fakeTop?: number }).fakeTop ?? 0; },
            set(this: HTMLElement, value: number) { (this as unknown as { fakeTop?: number }).fakeTop = value; },
        });
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
            configurable: true,
            get(this: HTMLElement) { return this.classList.contains('qaap-model-picker-rail') ? 600 : 0; },
        });
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
            configurable: true,
            get(this: HTMLElement) { return this.classList.contains('qaap-model-picker-rail') ? 200 : 0; },
        });
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
            configurable: true,
            value(this: HTMLElement) { revealed.push(this.title); },
        });
        try {
            renderQaapComposerModelPicker(host, props({
                state: state({ harnesses, railSelection: 'agent-9', currentAgentId: 'agent-9' }),
            }));
            const rail = host.querySelector<HTMLElement>('.qaap-model-picker-rail')!;
            // The shared edge-fade helper syncs on the next frame.
            await nextFrame();
            expect(rail.classList.contains('qaap-mod-scroll-fade-bottom')).to.equal(true);
            expect(rail.classList.contains('qaap-mod-scroll-fade-top')).to.equal(false);
            expect(revealed).to.deep.equal(['Agent 9']);

            rail.scrollTop = 200;
            rail.dispatchEvent(new window.Event('scroll'));
            await nextFrame();
            expect(rail.classList.contains('qaap-mod-scroll-fade-top')).to.equal(true);
            expect(rail.classList.contains('qaap-mod-scroll-fade-bottom')).to.equal(true);
            expect(revealed).to.deep.equal(['Agent 9']);
        } finally {
            restoreDescriptor('scrollTop', scrollTopDescriptor);
            restoreDescriptor('scrollHeight', scrollHeightDescriptor);
            restoreDescriptor('clientHeight', clientHeightDescriptor);
            restoreDescriptor('scrollIntoView', scrollIntoViewDescriptor);
        }

        function restoreDescriptor(name: string, descriptor: PropertyDescriptor | undefined): void {
            if (descriptor) {
                Object.defineProperty(HTMLElement.prototype, name, descriptor);
            } else {
                delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
            }
        }
    });

    it('keeps the search field focused and its text while typing several characters', () => {
        let query = '';
        const paint = (): void => {
            renderQaapComposerModelPicker(host, props({
                state: state({ query }),
                onQuery: value => { query = value; paint(); },
            }));
        };
        paint();
        const input = host.querySelector<HTMLInputElement>('.qaap-model-picker-search input')!;
        input.focus();
        for (const character of 'opu') {
            input.value += character;
            input.dispatchEvent(new window.Event('input'));
        }
        expect(document.activeElement).to.equal(host.querySelector('.qaap-model-picker-search input'));
        expect(host.querySelector<HTMLInputElement>('.qaap-model-picker-search input')!.value).to.equal('opu');
        expect(rows(host).map(row => row.dataset.modelId)).to.deep.equal(['opus-4-6']);
    });
});
