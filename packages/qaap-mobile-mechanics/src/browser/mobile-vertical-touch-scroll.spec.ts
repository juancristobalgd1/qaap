// *****************************************************************************
// Copyright (C) 2026 theia-ide and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';
import { expect } from 'chai';
import {
    isMobileScrollCompositorExcluded,
    MOBILE_SCROLL_COMPOSITOR_EXCLUDED_SELECTORS,
    MOBILE_SCROLL_GPU_COMPOSITOR_CLASS,
    MOBILE_VERTICAL_SCROLL_SELECTORS,
} from './mobile-vertical-touch-scroll';

/** Overlay scroll hosts added with product UI — must stay registered in touch-scroll CSS. */
const OVERLAY_SCROLL_HOSTS = [
    '.theia-mobile-work-hub-sessions-sidebar-scroll',
    '.theia-mobile-sticky-composer-sheet-list',
    '.qaap-chat-context-usage-sheet-body',
    '.theia-qaap-approval-policy-sheet-list',
    '.qaap-project-bootstrap-picker',
    // Codex-style execution event timeline: terminal output card content is a
    // scroll host rendered inside the transcript overlay (outside #theia-app-shell).
    '.theia-mobile-terminal-output-content',
    // Working DETAIL live VPS command output (mounted outside #theia-app-shell).
    '.qaap-working-agents-detail-command-log-output',
    // Step plan to-do menu (portaled to body from sticky composer pill).
    '.theia-mobile-sticky-composer-step-menu-list',
] as const;

/**
 * LobeHub WorkflowCollapse semi level caps the detail panel at
 * min(40vh, 320px) while its children (args 240px + result 320px + gaps)
 * can exceed that, so the detail panel itself becomes the scroll host on
 * mobile. Must stay registered in both the JS touch-pan fallback and the
 * touch-scroll CSS (mobile-touch-accessibility rule).
 */
const QAAP_LOBEHUB_TOOL_DETAIL_SEMI = '.qaap-lh-tool-detail[data-expand-level="semi"]';

/**
 * The handful of sheet/menu overlays whose mobile-touch-accessibility regression is the
 * most visible (see .cursor/rules/mobile-touch-accessibility.mdc reference patterns) —
 * a fingers-can't-scroll-it bug on any of these breaks a primary composer or navigation flow.
 */
const CRITICAL_SHEETS = [
    '.theia-mobile-work-hub-sessions-sidebar-scroll',
    '.theia-mobile-sticky-composer-sheet-list',
    '.theia-qaap-approval-policy-sheet-list',
    '.theia-mobile-sticky-composer-tools-host',
    '.theia-mobile-parallel-model-menu-list',
] as const;

/** Checklist entries added to close a TS/CSS registration gap. */
const NEWLY_REGISTERED_HOSTS = [
    '.theia-mobile-onboarding-body',
    '.theia-mobile-bottom-actionsheet',
    '.theia-mobile-routine-sheet-panel',
    '.theia-mobile-pr-quick-row',
] as const;

/**
 * Parses the selector list inside the "Vertical scroll hosts" CSS rule (from the comment
 * through the opening `{`) into individual class/id tokens. Used only as a secondary
 * documentation cross-check: compound selectors (`:not(...)`, descendant combinators,
 * attribute-only selectors) do not round-trip 1:1 through this kind of naive tokenizer, so
 * the authoritative assertion is the simpler "every TS selector is a substring of the CSS
 * file" check further down.
 */
function extractCssVerticalHostSelectors(css: string): string[] {
    const start = css.indexOf('Vertical scroll hosts');
    const slice = css.slice(start, start + 8000);
    const brace = slice.indexOf('{');
    const list = slice.slice(0, brace);
    return [...list.matchAll(/(\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*(?:\[[^\]]+\])?|#theia-[A-Za-z0-9_-]+)/g)].map(m => m[1]);
}

describe('mobile-vertical-touch-scroll', () => {

    it('registers overlay scroll hosts for MutationObserver patching', () => {
        for (const selector of OVERLAY_SCROLL_HOSTS) {
            expect(MOBILE_VERTICAL_SCROLL_SELECTORS).to.include(selector);
        }
    });

    it('lists the same overlay scroll hosts in qaap-mobile-touch-scroll.css', () => {
        const cssPath = path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'qaap-mobile-touch-scroll.css');
        const css = fs.readFileSync(cssPath, 'utf8');
        for (const selector of OVERLAY_SCROLL_HOSTS) {
            expect(css, `missing ${selector} in qaap-mobile-touch-scroll.css`).to.include(selector);
        }
    });

    it('keeps the integrated terminal viewport as the native scroll boundary', () => {
        const cssPath = path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'qaap-mobile-touch-scroll.css');
        const css = fs.readFileSync(cssPath, 'utf8');
        expect(css).to.include('#theia-app-shell .terminal-container .xterm-viewport');
        expect(css).to.include('overflow-y: auto !important');
        expect(css).to.include('overscroll-behavior-y: none !important');
    });

    it('registers GPU compositor scroll isolation in qaap-mobile-touch-scroll.css', () => {
        const cssPath = path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'qaap-mobile-touch-scroll.css');
        const css = fs.readFileSync(cssPath, 'utf8');
        expect(css).to.include('contain: layout style paint');
        expect(css).to.include(`.${MOBILE_SCROLL_GPU_COMPOSITOR_CLASS}:not(.theia-mobile-projects-scroll)`);
        expect(css).to.include('translate3d(0, 0, 0)');
    });

    it('excludes Work Hub projects scroll from compositor promotion', () => {
        expect(MOBILE_SCROLL_COMPOSITOR_EXCLUDED_SELECTORS).to.include('.theia-mobile-projects-scroll');
    });

    it('does not treat transcript real-chat as the scroll host (inner list scrolls)', () => {
        expect(MOBILE_VERTICAL_SCROLL_SELECTORS).to.not.include(
            '.theia-mobile-agents-hub-inline-transcript .theia-mobile-agent-transcript-real-chat',
        );
    });

    it('isMobileScrollCompositorExcluded guards Work Hub projects scroll', () => {
        const projectsScroll = {
            matches: (selector: string) => selector === '.theia-mobile-projects-scroll',
        } as unknown as HTMLElement;
        const transcript = { matches: () => false } as unknown as HTMLElement;
        expect(isMobileScrollCompositorExcluded(projectsScroll)).to.equal(true);
        expect(isMobileScrollCompositorExcluded(transcript)).to.equal(false);
    });

    it('registers the LobeHub WorkflowCollapse semi detail panel in the JS touch-pan fallback', () => {
        // The detail panel becomes the scroll host when capped at
        // min(40vh, 320px) but its children overflow — without this entry
        // the iOS nested-scroll fallback never installs and the panel won't
        // pan with the finger (mobile-touch-accessibility rule).
        expect(MOBILE_VERTICAL_SCROLL_SELECTORS, 'semi detail panel missing from JS fallback').to.include(
            QAAP_LOBEHUB_TOOL_DETAIL_SEMI,
        );
    });

    it('lists the LobeHub WorkflowCollapse semi detail panel in qaap-mobile-touch-scroll.css', () => {
        const cssPath = path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'qaap-mobile-touch-scroll.css');
        const css = fs.readFileSync(cssPath, 'utf8');
        expect(css, 'semi detail panel missing from touch-scroll CSS').to.include(QAAP_LOBEHUB_TOOL_DETAIL_SEMI);
    });

    describe('touch scroll checklist', () => {
        const cssPath = path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'qaap-mobile-touch-scroll.css');
        const css = fs.readFileSync(cssPath, 'utf8');

        it('registers every critical sheet/menu overlay in both the JS fallback and the CSS', () => {
            for (const selector of CRITICAL_SHEETS) {
                expect(MOBILE_VERTICAL_SCROLL_SELECTORS, `${selector} missing from TS`).to.include(selector);
                expect(css, `${selector} missing from CSS`).to.include(selector);
            }
        });

        it('registers the newly added checklist hosts (onboarding, actionsheet, routine panel, PR quick row)', () => {
            for (const selector of NEWLY_REGISTERED_HOSTS) {
                expect(MOBILE_VERTICAL_SCROLL_SELECTORS, `${selector} missing from TS`).to.include(selector);
                expect(css, `${selector} missing from CSS`).to.include(selector);
            }
        });

        it('keeps every JS vertical-scroll selector registered as a substring of the CSS host list', () => {
            for (const selector of MOBILE_VERTICAL_SCROLL_SELECTORS) {
                expect(css, `${selector} (TS) missing from qaap-mobile-touch-scroll.css`).to.include(selector);
            }
        });

        it('finds every simple TS class selector tokenized out of the CSS "Vertical scroll hosts" rule', () => {
            const cssTokens = new Set(extractCssVerticalHostSelectors(css));
            const simpleSelectors = MOBILE_VERTICAL_SCROLL_SELECTORS.filter(selector =>
                /^\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*(?:\[[^\]]+\])?$/.test(selector));
            // Sanity: most of the list is made of simple (non-compound, non-descendant) selectors.
            expect(simpleSelectors.length).to.be.greaterThan(MOBILE_VERTICAL_SCROLL_SELECTORS.length / 2);
            for (const selector of simpleSelectors) {
                expect(cssTokens.has(selector), `${selector} not tokenized from the CSS Vertical scroll hosts block`).to.equal(true);
            }
        });
    });
});
