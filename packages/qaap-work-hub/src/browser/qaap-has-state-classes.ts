// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { setTranscriptBottomFollowLayoutFlush } from '@theia/qaap-transcript-overlay/lib/browser/qaap-transcript-bottom-follow';

/**
 * One former `subject:has(argument)` condition, now a plain class on the subject.
 *
 * `:has()` on an ancestor of the streaming transcript makes Chromium re-match the argument and
 * restyle the subject's subtree on every inserted chunk; a class set when the condition flips
 * costs nothing per frame.
 */
export interface QaapHasStateClassRule {
    /** Elements that carry the class (the old `:has()` subject, without its other qualifiers). */
    readonly subject: string;
    /**
     * The old `:has()` argument, verbatim. Supported shapes: `C` (a descendant), `> C` (a child)
     * and `A > B` (a descendant B whose parent A is itself a descendant), C/A/B compound selectors.
     */
    readonly has: string;
    /** Set on every `subject` element for which `has` matches a descendant; unique per rule. */
    readonly className: string;
    /**
     * Every class token and attribute name the condition depends on (subject and argument): only
     * mutations touching one of them re-evaluate the rule.
     */
    readonly classes: readonly string[];
    readonly attributes?: readonly string[];
    /** Ids the condition depends on (an id subject inserted after start-up). */
    readonly ids?: readonly string[];
}

/**
 * Every `:has()` whose subject is an ancestor of the streaming transcript (Chromium flags those
 * ancestors and re-matches them on each inserted chunk, even when the argument is unrelated).
 * The CSS repeats the class as many times as the argument had classes/attributes
 * (`.theia-mod-has-x.theia-mod-has-x`) so each rule keeps the specificity of the `:has()` it
 * replaced. Do not add `:has()` on these subjects again: add a rule here instead.
 *
 * Layering: stylesheets of lower packages (qaap-mobile-shell touch scroll, qaap-product-theme,
 * qaap-transcript, qaap-composer) read these classes, but only this qaap-work-hub contribution sets
 * them. An app that drops qaap-work-hub loses those rules; they only target Work Hub DOM anyway.
 * Classes are applied in the observer's microtask, before the next frame; code that measures
 * layout synchronously right after a mutation calls {@link QaapHasStateClasses.flush} first
 * (the reduced-motion follow-tail does, through `setTranscriptBottomFollowLayoutFlush`).
 */
export const QAAP_HAS_STATE_CLASS_RULES: readonly QaapHasStateClassRule[] = [
    // `body` — overlays and surfaces.
    {
        subject: 'body',
        has: '.theia-mobile-agent-transcript-root.theia-mod-visible',
        className: 'theia-mobile-mod-has-transcript-overlay',
        classes: ['theia-mobile-agent-transcript-root', 'theia-mod-visible'],
    },
    {
        subject: 'body',
        has: '.theia-mobile-projects.theia-mod-visible',
        className: 'theia-mobile-mod-has-work-hub-visible',
        classes: ['theia-mobile-projects', 'theia-mod-visible'],
    },
    {
        subject: 'body',
        has: '.lm-Widget.dialogOverlay:not(.hidden)',
        className: 'theia-mobile-mod-has-dialog-overlay',
        classes: ['lm-Widget', 'dialogOverlay', 'hidden'],
    },
    {
        subject: 'body',
        has: '.theia-mobile-work-hub-preferences.theia-mod-visible',
        className: 'theia-mobile-mod-has-work-hub-preferences',
        classes: ['theia-mobile-work-hub-preferences', 'theia-mod-visible'],
    },
    // `.theia-mobile-projects` — the Work Hub panel that hosts the inline transcript.
    {
        subject: '.theia-mobile-projects',
        has: '.theia-mobile-projects-sticky-composer-card.theia-mod-codex',
        className: 'theia-mod-has-codex-composer',
        classes: ['theia-mobile-projects', 'theia-mobile-projects-sticky-composer-card', 'theia-mod-codex'],
    },
    {
        subject: '.theia-mobile-projects',
        has: '.theia-mobile-sticky-composer-changes-pill-host',
        className: 'theia-mod-has-changes-pill',
        classes: ['theia-mobile-projects', 'theia-mobile-sticky-composer-changes-pill-host'],
    },
    {
        subject: '.theia-mobile-projects',
        has: '.theia-mobile-agent-transcript > .theia-mobile-agent-live-status',
        className: 'theia-mod-has-live-status',
        classes: ['theia-mobile-projects', 'theia-mobile-agent-transcript', 'theia-mobile-agent-live-status'],
    },
    {
        subject: '.theia-mobile-projects',
        has: '.theia-mobile-agent-transcript.theia-mod-empty-chat',
        className: 'theia-mod-has-empty-chat',
        classes: ['theia-mobile-projects', 'theia-mobile-agent-transcript', 'theia-mod-empty-chat'],
    },
    {
        subject: '.theia-mobile-projects',
        has: '.theia-mobile-agent-transcript-empty.theia-mod-no-project',
        className: 'theia-mod-has-no-project-empty',
        classes: ['theia-mobile-projects', 'theia-mobile-agent-transcript-empty', 'theia-mod-no-project'],
    },
    {
        subject: '.theia-mobile-projects',
        has: '.theia-mobile-open-repo.theia-mod-visible',
        className: 'theia-mod-has-open-repo',
        classes: ['theia-mobile-projects', 'theia-mobile-open-repo', 'theia-mod-visible'],
    },
    {
        subject: '.theia-mobile-projects',
        has: '.theia-mobile-projects-subtitle[hidden]',
        className: 'theia-mod-has-hidden-subtitle',
        classes: ['theia-mobile-projects', 'theia-mobile-projects-subtitle'],
        attributes: ['hidden'],
    },
    {
        subject: '.theia-mobile-projects',
        has: '.qaap-transcript-workspace-context:not([hidden])',
        className: 'theia-mod-has-workspace-context',
        classes: ['theia-mobile-projects', 'qaap-transcript-workspace-context'],
        attributes: ['hidden'],
    },
    {
        subject: '.theia-mobile-projects-scroll',
        has: '> .theia-mobile-work-hub-preferences.theia-mod-work-hub-inline',
        className: 'theia-mod-has-inline-preferences',
        classes: ['theia-mobile-projects-scroll', 'theia-mobile-work-hub-preferences', 'theia-mod-work-hub-inline'],
    },
    // The transcript chain itself.
    {
        subject: '.theia-mobile-agent-transcript-real-chat',
        has: '.theia-mobile-agent-transcript > .theia-mobile-agent-live-status',
        className: 'theia-mod-has-real-chat-live-status',
        classes: ['theia-mobile-agent-transcript-real-chat', 'theia-mobile-agent-transcript', 'theia-mobile-agent-live-status'],
    },
    {
        subject: '.theia-mobile-agent-transcript-real-chat',
        has: '> .chat-view-widget',
        className: 'theia-mod-has-chat-view-widget',
        classes: ['theia-mobile-agent-transcript-real-chat', 'chat-view-widget'],
    },
    {
        subject: '.theia-mobile-agent-transcript',
        has: '.theia-mod-transcript-recents',
        className: 'theia-mod-has-transcript-recents',
        classes: ['theia-mobile-agent-transcript', 'theia-mod-transcript-recents'],
    },
    {
        subject: '.theia-mobile-agent-transcript-segments',
        has: '.theia-mobile-agent-transcript-content',
        className: 'theia-mod-has-transcript-content',
        classes: ['theia-mobile-agent-transcript-segments', 'theia-mobile-agent-transcript-content'],
    },
    // The jump-to-end mount (the transcript host while the scroll-to-bottom button is mounted).
    {
        subject: '.theia-mod-transcript-scroll-to-bottom-mount',
        has: '.theia-mobile-agent-transcript.theia-mod-empty-chat',
        className: 'theia-mod-has-empty-chat-transcript',
        classes: ['theia-mod-transcript-scroll-to-bottom-mount', 'theia-mobile-agent-transcript', 'theia-mod-empty-chat'],
    },
    {
        subject: '.theia-mod-transcript-scroll-to-bottom-mount',
        has: '.theia-mobile-agent-transcript-empty',
        className: 'theia-mod-has-transcript-empty-state',
        classes: ['theia-mod-transcript-scroll-to-bottom-mount', 'theia-mobile-agent-transcript-empty'],
    },
    // The full-screen transcript sheet (appended to `body`), same header conditions as the panel.
    {
        subject: '.theia-mobile-agent-transcript-root',
        has: '.theia-mobile-projects-subtitle[hidden]',
        className: 'theia-mod-has-sheet-hidden-subtitle',
        classes: ['theia-mobile-agent-transcript-root', 'theia-mobile-projects-subtitle'],
        attributes: ['hidden'],
    },
    {
        subject: '.theia-mobile-agent-transcript-root',
        has: '.qaap-transcript-workspace-context:not([hidden])',
        className: 'theia-mod-has-sheet-workspace-context',
        classes: ['theia-mobile-agent-transcript-root', 'qaap-transcript-workspace-context'],
        attributes: ['hidden'],
    },
    // Desktop IDE: the Work Hub chat docked in the right side panel.
    {
        subject: '#theia-right-content-panel',
        has: '.qaap-work-hub-chat-view-widget',
        className: 'theia-mod-has-work-hub-chat-view',
        classes: ['qaap-work-hub-chat-view-widget'],
        ids: ['theia-right-content-panel'],
    },
];

interface QaapHasStateAnchors {
    /** Elements whose subject ancestors (or themselves) may have changed. */
    readonly elements: Set<Element>;
    /** Inserted nodes: their own subtree may also hold subjects. */
    readonly inserted: Set<Element>;
}

/** Tracks {@link QAAP_HAS_STATE_CLASS_RULES} on the live document. */
@injectable()
export class QaapHasStateClasses implements FrontendApplicationContribution {

    protected readonly rules: readonly QaapHasStateClassRule[] = QAAP_HAS_STATE_CLASS_RULES;
    protected readonly rulesByClass = new Map<string, QaapHasStateClassRule[]>();
    protected readonly rulesByAttribute = new Map<string, QaapHasStateClassRule[]>();
    protected readonly rulesById = new Map<string, QaapHasStateClassRule[]>();
    protected readonly matchers = new Map<QaapHasStateClassRule, (subject: Element) => boolean>();
    /** Selector matching any element that carries a tracked class token. */
    protected trackedClassSelector = '';
    protected observer: MutationObserver | undefined;
    protected document: Document | undefined;

    initialize(): void {
        if (typeof document !== 'undefined') {
            this.start(document);
        }
    }

    /** The shell is attached by now: pick up subjects that only exist once it is (side panels). */
    onStart(): void {
        if (this.observer) {
            this.reconcile(this.rules);
        }
    }

    onStop(): void {
        this.stop();
    }

    start(doc: Document): void {
        if (this.observer || !doc.body || typeof doc.defaultView?.MutationObserver !== 'function') {
            return;
        }
        this.document = doc;
        this.indexRules();
        const attributeFilter = ['class', ...this.rulesByAttribute.keys()];
        this.observer = new doc.defaultView.MutationObserver(records => this.onMutations(records));
        this.observer.observe(doc.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeOldValue: true,
            attributeFilter,
        });
        setTranscriptBottomFollowLayoutFlush(() => this.flush());
        // `body` itself can change class (theme, surface): rules whose subject is `body` re-check below.
        this.reconcile(this.rules);
    }

    stop(): void {
        if (this.observer) {
            setTranscriptBottomFollowLayoutFlush(undefined);
        }
        this.observer?.disconnect();
        this.observer = undefined;
        this.document = undefined;
    }

    /** Apply pending mutations now, for callers that read layout right after changing the DOM. */
    flush(): void {
        const records = this.observer?.takeRecords();
        if (records?.length) {
            this.onMutations(records);
        }
    }

    protected indexRules(): void {
        this.rulesByClass.clear();
        this.rulesByAttribute.clear();
        this.rulesById.clear();
        this.matchers.clear();
        for (const rule of this.rules) {
            this.matchers.set(rule, this.createMatcher(rule.has));
            for (const token of rule.classes) {
                this.addIndexed(this.rulesByClass, token, rule);
            }
            for (const attribute of rule.attributes ?? []) {
                this.addIndexed(this.rulesByAttribute, attribute, rule);
            }
            for (const id of rule.ids ?? []) {
                this.addIndexed(this.rulesById, id, rule);
            }
        }
        this.trackedClassSelector = [
            ...[...this.rulesByClass.keys()].map(token => `.${token}`),
            ...[...this.rulesById.keys()].map(id => `#${id}`),
        ].join(',');
    }

    /** `subject:has(argument)` without `:scope`, which some engines resolve wrongly for nested subjects. */
    protected createMatcher(argument: string): (subject: Element) => boolean {
        const child = /^>\s*([^\s>]+)$/.exec(argument);
        if (child) {
            const compound = child[1];
            return subject => Array.from(subject.children).some(element => element.matches(compound));
        }
        const parentChild = /^([^\s>]+)\s*>\s*([^\s>]+)$/.exec(argument);
        if (parentChild) {
            const [, parent, compound] = parentChild;
            return subject => Array.from(subject.querySelectorAll(compound))
                .some(element => element.parentElement !== subject && element.parentElement!.matches(parent));
        }
        if (/^[^\s>+~]+$/.test(argument)) {
            return subject => !!subject.querySelector(argument);
        }
        throw new Error(`Unsupported :has() argument: ${argument}`);
    }

    protected addIndexed(index: Map<string, QaapHasStateClassRule[]>, key: string, rule: QaapHasStateClassRule): void {
        const rules = index.get(key);
        if (rules) {
            rules.push(rule);
        } else {
            index.set(key, [rule]);
        }
    }

    protected onMutations(records: readonly MutationRecord[]): void {
        // Per dirty rule, the elements the mutation touched: only their subject ancestors (and, for
        // inserted nodes, the subjects inside them) can change, so long transcripts are not re-walked.
        const dirty = new Map<QaapHasStateClassRule, QaapHasStateAnchors>();
        for (const record of records) {
            const rules = new Set<QaapHasStateClassRule>();
            if (record.type === 'attributes') {
                this.collectAttributeRules(record, rules);
                this.addAnchors(dirty, rules, record.target as Element, false);
            } else {
                record.removedNodes.forEach(node => this.collectSubtreeRules(node, rules));
                this.addAnchors(dirty, rules, record.target as Element, false);
                record.addedNodes.forEach(node => {
                    const added = new Set<QaapHasStateClassRule>();
                    this.collectSubtreeRules(node, added);
                    this.addAnchors(dirty, added, node as Element, true);
                    // The parent's subject ancestors see the new descendant too.
                    this.addAnchors(dirty, added, record.target as Element, false);
                });
            }
        }
        for (const [rule, anchors] of dirty) {
            this.reconcileAround(rule, anchors);
        }
    }

    protected addAnchors(
        dirty: Map<QaapHasStateClassRule, QaapHasStateAnchors>,
        rules: Set<QaapHasStateClassRule>,
        anchor: Element,
        inserted: boolean,
    ): void {
        for (const rule of rules) {
            let anchors = dirty.get(rule);
            if (!anchors) {
                anchors = { elements: new Set(), inserted: new Set() };
                dirty.set(rule, anchors);
            }
            (inserted ? anchors.inserted : anchors.elements).add(anchor);
        }
    }

    /** Re-evaluates the subjects that are, or contain, the touched elements. */
    protected reconcileAround(rule: QaapHasStateClassRule, anchors: QaapHasStateAnchors): void {
        const doc = this.document;
        if (!doc?.body) {
            return;
        }
        if (rule.subject === 'body') {
            this.reconcileSubject(rule, doc.body);
            return;
        }
        const subjects = new Set<Element>();
        const addSelfAndAncestors = (anchor: Element): void => {
            if (anchor.classList.contains(rule.className) && !anchor.matches(rule.subject)) {
                anchor.classList.remove(rule.className);
            }
            let subject = anchor.closest(rule.subject) ?? undefined;
            while (subject) {
                subjects.add(subject);
                subject = subject.parentElement?.closest(rule.subject) ?? undefined;
            }
        };
        anchors.elements.forEach(addSelfAndAncestors);
        anchors.inserted.forEach(anchor => {
            addSelfAndAncestors(anchor);
            anchor.querySelectorAll(rule.subject).forEach(subject => subjects.add(subject));
            anchor.querySelectorAll(`.${rule.className}`).forEach(element => {
                if (!element.matches(rule.subject)) {
                    element.classList.remove(rule.className);
                }
            });
        });
        subjects.forEach(subject => {
            if (subject.isConnected) {
                this.reconcileSubject(rule, subject);
            }
        });
    }

    protected reconcileSubject(rule: QaapHasStateClassRule, subject: Element): void {
        const matches = this.matchers.get(rule)!(subject);
        if (subject.classList.contains(rule.className) !== matches) {
            subject.classList.toggle(rule.className, matches);
        }
    }

    protected collectAttributeRules(record: MutationRecord, dirty: Set<QaapHasStateClassRule>): void {
        const target = record.target as Element;
        if (record.attributeName !== 'class') {
            // A tracked attribute (`hidden`) only matters on an element the argument names by class.
            if (this.rulesByAttribute.has(record.attributeName ?? '')) {
                this.collectElementRules(target, dirty, rule => rule.attributes?.includes(record.attributeName!) === true);
            }
            return;
        }
        const value = target.getAttribute('class') ?? '';
        if ((record.oldValue ?? '') === value) {
            return;
        }
        const before = new Set((record.oldValue ?? '').split(/\s+/).filter(Boolean));
        for (const token of Array.from(target.classList)) {
            if (!before.delete(token)) {
                this.addRulesForClass(token, dirty);
            }
        }
        // What is left in `before` was removed.
        for (const token of before) {
            this.addRulesForClass(token, dirty);
        }
    }

    protected collectSubtreeRules(node: Node, dirty: Set<QaapHasStateClassRule>): void {
        if (node.nodeType !== 1 /* ELEMENT_NODE */) {
            return;
        }
        const element = node as Element;
        this.collectElementRules(element, dirty);
        if (element.firstElementChild && this.trackedClassSelector) {
            element.querySelectorAll(this.trackedClassSelector).forEach(descendant => this.collectElementRules(descendant, dirty));
        }
    }

    protected collectElementRules(
        element: Element,
        dirty: Set<QaapHasStateClassRule>,
        filter: (rule: QaapHasStateClassRule) => boolean = () => true,
    ): void {
        for (const rule of (element.id && this.rulesById.get(element.id)) || []) {
            if (filter(rule)) {
                dirty.add(rule);
            }
        }
        for (const token of Array.from(element.classList)) {
            for (const rule of this.rulesByClass.get(token) ?? []) {
                if (filter(rule)) {
                    dirty.add(rule);
                }
            }
        }
    }

    protected addRulesForClass(token: string, dirty: Set<QaapHasStateClassRule>): void {
        for (const rule of this.rulesByClass.get(token) ?? []) {
            dirty.add(rule);
        }
    }

    protected reconcile(rules: Iterable<QaapHasStateClassRule>): void {
        const doc = this.document;
        if (!doc?.body) {
            return;
        }
        for (const rule of rules) {
            const subjects = rule.subject === 'body' ? [doc.body] : Array.from(doc.body.querySelectorAll(rule.subject));
            for (const subject of subjects) {
                this.reconcileSubject(rule, subject);
            }
            // An element that stopped being a subject keeps no stale class.
            doc.body.querySelectorAll(`.${rule.className}`).forEach(element => {
                if (!element.matches(rule.subject)) {
                    element.classList.remove(rule.className);
                }
            });
        }
    }
}
