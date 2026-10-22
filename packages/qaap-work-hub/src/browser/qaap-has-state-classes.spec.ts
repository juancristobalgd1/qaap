// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { readFileSync } from 'fs';
import * as path from 'path';
import { followTranscriptBottom } from '@theia/qaap-transcript-overlay/lib/browser/qaap-transcript-bottom-follow';
import { QAAP_HAS_STATE_CLASS_RULES, QaapHasStateClasses, QaapHasStateClassRule } from './qaap-has-state-classes';

disableImportJSDOM();

class TestHasStateClasses extends QaapHasStateClasses {
    constructor(protected override readonly rules: readonly QaapHasStateClassRule[]) {
        super();
    }
}

const flushMutations = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

describe('QaapHasStateClasses', () => {
    let disableSuiteJSDOM: () => void;
    let tracker: TestHasStateClasses | undefined;
    before(() => { disableSuiteJSDOM = enableJSDOM(); });
    after(() => disableSuiteJSDOM());
    afterEach(() => {
        tracker?.stop();
        tracker = undefined;
        document.body.className = '';
        document.body.innerHTML = '';
    });

    const start = (rules: QaapHasStateClassRule[]): TestHasStateClasses => {
        tracker = new TestHasStateClasses(rules);
        tracker.start(document);
        return tracker;
    };

    it('sets the body class while a matching descendant exists', async () => {
        start([{ subject: 'body', has: '.overlay.theia-mod-visible', className: 'theia-mobile-mod-has-overlay', classes: ['overlay', 'theia-mod-visible'] }]);
        expect(document.body.classList.contains('theia-mobile-mod-has-overlay')).to.equal(false);

        const overlay = document.createElement('div');
        overlay.className = 'overlay theia-mod-visible';
        document.body.append(overlay);
        await flushMutations();
        expect(document.body.classList.contains('theia-mobile-mod-has-overlay')).to.equal(true);

        overlay.classList.remove('theia-mod-visible');
        await flushMutations();
        expect(document.body.classList.contains('theia-mobile-mod-has-overlay')).to.equal(false);

        overlay.classList.add('theia-mod-visible');
        await flushMutations();
        expect(document.body.classList.contains('theia-mobile-mod-has-overlay')).to.equal(true);

        overlay.remove();
        await flushMutations();
        expect(document.body.classList.contains('theia-mobile-mod-has-overlay')).to.equal(false);
    });

    it('sees a match inserted deep inside a larger subtree', async () => {
        start([{ subject: 'body', has: '.overlay', className: 'theia-mobile-mod-has-overlay', classes: ['overlay'] }]);
        const wrapper = document.createElement('div');
        wrapper.innerHTML = '<section><p>chunk</p><div class="overlay"></div></section>';
        document.body.append(wrapper);
        await flushMutations();
        expect(document.body.classList.contains('theia-mobile-mod-has-overlay')).to.equal(true);

        wrapper.remove();
        await flushMutations();
        expect(document.body.classList.contains('theia-mobile-mod-has-overlay')).to.equal(false);
    });

    it('tracks every subject element on its own and honours child arguments', async () => {
        document.body.innerHTML = '<div class="chat" id="a"><div class="widget"></div></div>'
            + '<div class="chat" id="b"><span><div class="widget"></div></span></div>';
        start([{ subject: '.chat', has: '> .widget', className: 'theia-mod-has-widget', classes: ['chat', 'widget'] }]);
        const a = document.getElementById('a')!;
        const b = document.getElementById('b')!;
        expect(a.classList.contains('theia-mod-has-widget')).to.equal(true);
        expect(b.classList.contains('theia-mod-has-widget')).to.equal(false);

        const direct = document.createElement('div');
        direct.className = 'widget';
        b.append(direct);
        a.replaceChildren();
        await flushMutations();
        expect(a.classList.contains('theia-mod-has-widget')).to.equal(false);
        expect(b.classList.contains('theia-mod-has-widget')).to.equal(true);
    });

    it('drops the class from an element that stops being a subject', async () => {
        document.body.innerHTML = '<div class="chat" id="a"><div class="widget"></div></div>';
        start([{ subject: '.chat', has: '.widget', className: 'theia-mod-has-widget', classes: ['chat', 'widget'] }]);
        const a = document.getElementById('a')!;
        expect(a.classList.contains('theia-mod-has-widget')).to.equal(true);
        a.classList.remove('chat');
        await flushMutations();
        expect(a.classList.contains('theia-mod-has-widget')).to.equal(false);
    });

    it('re-checks tracked attributes such as hidden', async () => {
        document.body.innerHTML = '<div class="panel" id="p"><span class="subtitle"></span></div>';
        start([{ subject: '.panel', has: '.subtitle[hidden]', className: 'theia-mod-has-hidden-subtitle', classes: ['panel', 'subtitle'], attributes: ['hidden'] }]);
        const panel = document.getElementById('p')!;
        const subtitle = panel.querySelector<HTMLElement>('.subtitle')!;
        expect(panel.classList.contains('theia-mod-has-hidden-subtitle')).to.equal(false);
        subtitle.hidden = true;
        await flushMutations();
        expect(panel.classList.contains('theia-mod-has-hidden-subtitle')).to.equal(true);
        subtitle.hidden = false;
        await flushMutations();
        expect(panel.classList.contains('theia-mod-has-hidden-subtitle')).to.equal(false);
    });

    interface SubjectSpy {
        reconcileSubject(rule: QaapHasStateClassRule, subject: Element): void;
    }
    const countSubjectChecks = (target: TestHasStateClasses): Element[] => {
        const checked: Element[] = [];
        const spy = target as unknown as SubjectSpy;
        const original = spy.reconcileSubject.bind(target);
        spy.reconcileSubject = (rule, subject) => {
            checked.push(subject);
            original(rule, subject);
        };
        return checked;
    };

    it('ignores mutations that touch no tracked class', async () => {
        const checked = countSubjectChecks(start([{ subject: 'body', has: '.overlay', className: 'theia-mobile-mod-has-overlay', classes: ['overlay'] }]));
        const row = document.createElement('div');
        row.className = 'row';
        document.body.append(row);
        row.textContent = 'streamed chunk';
        row.classList.add('theia-mod-streaming');
        await flushMutations();
        expect(checked).to.have.length(0);
    });

    it('re-checks only the subjects around the mutation, not every subject in the document', async () => {
        document.body.innerHTML = Array.from({ length: 50 }, (_, index) =>
            `<div class="segments" id="s${index}"><span class="content"></span></div>`).join('');
        const checked = countSubjectChecks(start([{ subject: '.segments', has: '.content', className: 'theia-mod-has-content', classes: ['segments', 'content'] }]));
        const last = document.getElementById('s49')!;
        last.replaceChildren();
        await flushMutations();
        expect(checked).to.deep.equal([last]);
        expect(last.classList.contains('theia-mod-has-content')).to.equal(false);
        expect(document.getElementById('s0')!.classList.contains('theia-mod-has-content')).to.equal(true);
    });

    it('flushes pending classes before the reduced-motion follow-tail measures the scroller', () => {
        const previousMatchMedia = window.matchMedia;
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            writable: true,
            value: (query: string) => ({ matches: query.includes('reduce'), media: query }),
        });
        try {
            start([{ subject: 'body', has: '.overlay', className: 'theia-mobile-mod-has-overlay', classes: ['overlay'] }]);
            const overlay = document.createElement('div');
            overlay.className = 'overlay';
            document.body.append(overlay);
            followTranscriptBottom(document.createElement('div'));
            expect(document.body.classList.contains('theia-mobile-mod-has-overlay')).to.equal(true);
        } finally {
            Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: previousMatchMedia });
        }
    });

    it('clears the class when nested nodes are removed in the same task', async () => {
        document.body.innerHTML = '<div class="panel" id="panel"><div class="row" id="row"><div class="pill" id="pill"></div></div></div>';
        start([{ subject: '.panel', has: '.pill', className: 'theia-mod-has-pill', classes: ['panel', 'pill'] }]);
        const panel = document.getElementById('panel')!;
        expect(panel.classList.contains('theia-mod-has-pill')).to.equal(true);
        // The first record's target (the row) is detached by the second one before the observer runs.
        document.getElementById('pill')!.remove();
        document.getElementById('row')!.remove();
        await flushMutations();
        expect(panel.classList.contains('theia-mod-has-pill')).to.equal(false);
    });

    it('clears the class when the parent of a removed match is moved out in the same task', async () => {
        document.body.innerHTML = '<div class="panel" id="panel"><div class="row" id="row"><div class="pill" id="pill"></div></div></div><div id="elsewhere"></div>';
        start([{ subject: '.panel', has: '.pill', className: 'theia-mod-has-pill', classes: ['panel', 'pill'] }]);
        const row = document.getElementById('row')!;
        document.getElementById('pill')!.remove();
        document.getElementById('elsewhere')!.append(row);
        await flushMutations();
        expect(document.getElementById('panel')!.classList.contains('theia-mod-has-pill')).to.equal(false);
    });

    it('flush() applies pending mutations synchronously', () => {
        start([{ subject: 'body', has: '.overlay', className: 'theia-mobile-mod-has-overlay', classes: ['overlay'] }]);
        const overlay = document.createElement('div');
        overlay.className = 'overlay';
        document.body.append(overlay);
        tracker!.flush();
        expect(document.body.classList.contains('theia-mobile-mod-has-overlay')).to.equal(true);
    });
});

describe('QAAP_HAS_STATE_CLASS_RULES equivalence', () => {
    let disableSuiteJSDOM: () => void;
    before(() => { disableSuiteJSDOM = enableJSDOM(); });
    after(() => disableSuiteJSDOM());

    // Deterministic PRNG so a failure reproduces.
    let seed = 7;
    const random = (): number => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
    };
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];

    /**
     * `subject:has(argument)` in plain DOM walks for the argument shapes the rules use (`C`, `> C`,
     * `A > B`): jsdom's selector engine answers `:has()` wrongly for nested subjects.
     */
    const matchesHas = (element: Element, rule: QaapHasStateClassRule): boolean => {
        if (!element.matches(rule.subject)) {
            return false;
        }
        const argument = rule.has;
        const descendants = Array.from(element.querySelectorAll('*'));
        if (argument.startsWith('> ')) {
            const compound = argument.slice(2);
            return Array.from(element.children).some(item => item.matches(compound));
        }
        const [parent, child] = argument.split(' > ');
        if (child === undefined) {
            return descendants.some(descendant => descendant.matches(parent));
        }
        return descendants.some(descendant => descendant.matches(child)
            && descendant.parentElement !== element && descendant.parentElement!.matches(parent));
    };

    it('reads every rule argument as one of the shapes the oracle knows', () => {
        for (const rule of QAAP_HAS_STATE_CLASS_RULES) {
            expect(rule.has, rule.className).to.match(/^(> )?[^ >]+( > [^ >]+)?$/);
        }
    });

    const fuzz = (name: string, rules: readonly QaapHasStateClassRule[]): void => {
        it(name, async () => {
            document.body.className = '';
            document.body.innerHTML = '';
            const tracker = new TestHasStateClasses(rules);
            tracker.start(document);
            const tokens = [...new Set([...rules.flatMap(rule => rule.classes), 'lm-Widget', 'other'])];
            const ids = [...new Set(rules.flatMap(rule => rule.ids ?? []))];
            const elements = (): Element[] => Array.from(document.body.querySelectorAll('*'));
            try {
                for (let step = 0; step < 400; step++) {
                    // 1–5 mutations per observer batch: records in one batch can see each other's effects.
                    const batch = 1 + Math.floor(random() * 5);
                    for (let mutation = 0; mutation < batch; mutation++) {
                        const all = elements();
                        const action = random();
                        if (action < 0.35 || all.length < 3) {
                            const element = document.createElement(pick(['div', 'span', 'section']));
                            element.className = tokens.filter(() => random() < 0.3).join(' ');
                            if (ids.length && random() < 0.1 && !document.getElementById(ids[0])) {
                                element.id = ids[0];
                            }
                            (all.length && random() < 0.85 ? pick(all) : document.body).append(element);
                        } else if (action < 0.55) {
                            pick(all).classList.toggle(pick(tokens));
                        } else if (action < 0.65) {
                            const element = pick(all) as HTMLElement;
                            element.hidden = !element.hidden;
                        } else if (action < 0.8) {
                            pick(all).remove();
                        } else {
                            const [moved, target] = [pick(all), pick(all)];
                            if (!moved.contains(target)) {
                                if (random() < 0.5) {
                                    target.append(moved);
                                } else {
                                    target.before(moved);
                                }
                            }
                        }
                    }
                    await flushMutations();
                    for (const rule of rules) {
                        for (const element of [document.body, ...elements()]) {
                            expect(element.classList.contains(rule.className), `${rule.className} step ${step}: ${element.outerHTML.slice(0, 200)}`)
                                .to.equal(matchesHas(element, rule));
                        }
                    }
                }
            } finally {
                tracker.stop();
            }
        });
    };

    it('gives every rule its own class', () => {
        const classNames = QAAP_HAS_STATE_CLASS_RULES.map(rule => rule.className);
        expect(new Set(classNames).size).to.equal(classNames.length);
    });
    for (const rule of QAAP_HAS_STATE_CLASS_RULES) {
        fuzz(`${rule.className} matches ${rule.subject}:has(…) under random mutations`, [rule]);
    }
    fuzz('all rules together match their :has() under random mutations', QAAP_HAS_STATE_CLASS_RULES);
});

describe('QAAP_HAS_STATE_CLASS_RULES stylesheets', () => {
    const packagesRoot = path.resolve(__dirname, '../../..');
    const stylesheets = [
        'qaap-composer/src/browser/style/qaap-chat-select-dropdown.css',
        'qaap-mobile-shell/src/browser/style/qaap-mobile-touch-scroll.css',
        'qaap-product-theme/src/browser/style/qaap-chat-scroll-edges.css',
        'qaap-product-theme/src/browser/style/qaap-chat-scroll-to-bottom.css',
        'qaap-transcript/src/browser/style/qaap-transcript-live-status.css',
        'qaap-work-hub/src/browser/style/mobile-workbench-base.css',
        'qaap-work-hub/src/browser/style/mobile-workbench-conversation.css',
        'qaap-work-hub/src/browser/style/mobile-workbench-projects.css',
        'qaap-work-hub/src/browser/style/mobile-workbench-work-hub.css',
    ].map(file => ({ file, css: readFileSync(path.join(packagesRoot, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') }));
    const hotSubjectHas = new RegExp('(^|[\\s,>+~(])(body|#theia-right-content-panel|\\.theia-mobile-(projects|projects-scroll|'
        + 'agent-transcript|agent-transcript-root|agent-transcript-real-chat|agent-transcript-segments)|\\.theia-mod-transcript-scroll-to-bottom-mount)'
        + '(?![\\w-])(\\.[\\w-]+|:not\\((?:[^()]|\\([^()]*\\))*\\))*(:has\\(|:not\\(:has\\()', 'm');

    it('keeps :has() off the streaming transcript ancestors', () => {
        for (const { file, css } of stylesheets) {
            expect(hotSubjectHas.exec(css)?.[0], file).to.equal(undefined);
        }
    });

    it('catches the selectors it guards against', () => {
        expect(hotSubjectHas.test('body:not(:has(.a)) .b {')).to.equal(true);
        expect(hotSubjectHas.test('.x .theia-mobile-projects.theia-mod-sticky-composer:not(.y):has(.c) .d {')).to.equal(true);
        expect(hotSubjectHas.test('.theia-mobile-projects-task-row:has(.c) {')).to.equal(false);
    });

    it('every rule is read by a stylesheet', () => {
        const all = stylesheets.map(({ css }) => css).join('\n');
        for (const rule of QAAP_HAS_STATE_CLASS_RULES) {
            expect(all.includes(`.${rule.className}`), rule.className).to.equal(true);
        }
    });
});
