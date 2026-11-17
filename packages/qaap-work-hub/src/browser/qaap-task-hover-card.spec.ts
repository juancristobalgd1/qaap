// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as sinon from 'sinon';
import { QAAP_TASK_HOVER_CARD_DELAY_MS, QaapTaskHoverCard, isQaapTaskHoverCardSupported } from './qaap-task-hover-card';
import type { QaapTaskHoverCardModel } from './qaap-task-hover-card-model';

const MODEL: QaapTaskHoverCardModel = {
    title: 'Full task title',
    lines: [
        { kind: 'project', iconClass: 'codicon-repo', text: 'qaap' },
        { kind: 'diff', iconClass: 'codicon-diff', text: '5 lines added, 2 removed', added: 5, removed: 2 },
    ],
};

function pointer(type: string, pointerType = 'mouse'): Event {
    const event = new window.Event(type, { bubbles: type !== 'pointerenter' && type !== 'pointerleave' });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    return event;
}

describe('QaapTaskHoverCard', () => {

    let clock: sinon.SinonFakeTimers;
    let restore: () => void;
    let hoverCapable = true;
    let card: QaapTaskHoverCard;
    let row: HTMLElement;
    let trigger: HTMLButtonElement;

    beforeEach(() => {
        clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const previousSet = window.setTimeout;
        const previousClear = window.clearTimeout;
        const previousMatchMedia = window.matchMedia;
        window.setTimeout = globalThis.setTimeout as unknown as typeof window.setTimeout;
        window.clearTimeout = globalThis.clearTimeout as unknown as typeof window.clearTimeout;
        hoverCapable = true;
        window.matchMedia = ((query: string) => ({
            matches: query.includes('hover: hover') ? hoverCapable : false,
            media: query,
        })) as unknown as typeof window.matchMedia;
        restore = () => {
            window.setTimeout = previousSet;
            window.clearTimeout = previousClear;
            window.matchMedia = previousMatchMedia;
        };
        card = new QaapTaskHoverCard();
        row = document.createElement('div');
        trigger = document.createElement('button');
        row.append(trigger);
        document.body.append(row);
    });

    afterEach(() => {
        card.hide();
        row.remove();
        clock.restore();
        restore();
    });

    const shownCard = (): HTMLElement | undefined => document.querySelector<HTMLElement>('.theia-qaap-task-hover-card') ?? undefined;

    it('is supported only on hover-capable fine pointers', () => {
        expect(isQaapTaskHoverCardSupported()).to.equal(true);
        hoverCapable = false;
        expect(isQaapTaskHoverCardSupported()).to.equal(false);
    });

    it('shows the card after the rest delay and hides it on leave', () => {
        card.attach(row, trigger, () => MODEL);
        row.dispatchEvent(pointer('pointerenter'));
        clock.tick(QAAP_TASK_HOVER_CARD_DELAY_MS - 1);
        expect(shownCard()).to.equal(undefined);
        clock.tick(1);
        const shown = shownCard();
        expect(shown?.getAttribute('role')).to.equal('tooltip');
        expect(shown?.querySelector('.theia-qaap-task-hover-card-title')?.textContent).to.equal('Full task title');
        expect(shown?.querySelectorAll('.theia-qaap-task-hover-card-line')).to.have.length(2);
        expect(shown?.querySelector('.theia-qaap-task-hover-card-added')?.textContent).to.equal('+5');
        expect(trigger.getAttribute('aria-describedby')).to.equal(shown?.id);
        row.dispatchEvent(pointer('pointerleave'));
        expect(shownCard()).to.equal(undefined);
        expect(trigger.hasAttribute('aria-describedby')).to.equal(false);
    });

    it('never arms on touch pointers or hover-less devices', () => {
        card.attach(row, trigger, () => MODEL);
        row.dispatchEvent(pointer('pointerenter', 'touch'));
        clock.tick(QAAP_TASK_HOVER_CARD_DELAY_MS * 2);
        expect(shownCard()).to.equal(undefined);
        hoverCapable = false;
        row.dispatchEvent(pointer('pointerenter'));
        clock.tick(QAAP_TASK_HOVER_CARD_DELAY_MS * 2);
        expect(shownCard()).to.equal(undefined);
    });

    it('is dismissed by a click on the row, Escape and scroll', () => {
        card.attach(row, trigger, () => MODEL);
        row.dispatchEvent(pointer('pointerenter'));
        clock.tick(QAAP_TASK_HOVER_CARD_DELAY_MS);
        expect(shownCard()).to.not.equal(undefined);
        trigger.dispatchEvent(pointer('pointerdown'));
        expect(shownCard()).to.equal(undefined);

        row.dispatchEvent(pointer('pointerleave'));
        row.dispatchEvent(pointer('pointerenter'));
        clock.tick(QAAP_TASK_HOVER_CARD_DELAY_MS);
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
        expect(shownCard()).to.equal(undefined);

        row.dispatchEvent(pointer('pointerleave'));
        row.dispatchEvent(pointer('pointerenter'));
        clock.tick(QAAP_TASK_HOVER_CARD_DELAY_MS);
        window.dispatchEvent(new window.Event('scroll'));
        expect(shownCard()).to.equal(undefined);
    });

    it('cancels a pending card when the pointer leaves before the delay', () => {
        card.attach(row, trigger, () => MODEL);
        row.dispatchEvent(pointer('pointerenter'));
        clock.tick(QAAP_TASK_HOVER_CARD_DELAY_MS / 2);
        row.dispatchEvent(pointer('pointerleave'));
        clock.tick(QAAP_TASK_HOVER_CARD_DELAY_MS);
        expect(shownCard()).to.equal(undefined);
    });

    it('shows one card at a time', () => {
        const other = document.createElement('div');
        const otherTrigger = document.createElement('button');
        other.append(otherTrigger);
        document.body.append(other);
        try {
            card.attach(row, trigger, () => MODEL);
            card.attach(other, otherTrigger, () => ({ title: 'Other', lines: [] }));
            row.dispatchEvent(pointer('pointerenter'));
            clock.tick(QAAP_TASK_HOVER_CARD_DELAY_MS);
            other.dispatchEvent(pointer('pointerenter'));
            clock.tick(QAAP_TASK_HOVER_CARD_DELAY_MS);
            const cards = document.querySelectorAll('.theia-qaap-task-hover-card');
            expect(cards).to.have.length(1);
            expect(cards[0].querySelector('.theia-qaap-task-hover-card-title')?.textContent).to.equal('Other');
        } finally {
            other.remove();
        }
    });
});
