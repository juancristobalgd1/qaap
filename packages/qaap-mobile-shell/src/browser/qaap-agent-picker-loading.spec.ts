// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { expect } from 'chai';
import {
    renderAgentPickerLoadError,
    renderAgentPickerSkeleton,
    replaceAgentPickerLoading,
} from './qaap-agent-picker-loading';

describe('qaap-agent-picker-loading', () => {
    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    it('renders a stable initial skeleton with accessible busy state', () => {
        const list = document.createElement('div');
        renderAgentPickerSkeleton(list);

        expect(list.getAttribute('aria-busy')).to.equal('true');
        expect(list.querySelector('.theia-qaap-agent-sheet-skeleton')?.getAttribute('aria-hidden')).to.equal('true');
        expect(list.querySelectorAll('.theia-qaap-agent-sheet-skeleton-row')).to.have.length(6);
        expect(list.querySelector('.theia-qaap-agent-sheet-skeleton-row.theia-mod-selected')).to.not.equal(null);
        expect(list.querySelector('[role="status"]')?.textContent).to.equal('Loading agents and models');
    });

    it('atomically replaces loading content while preserving the search query', () => {
        const panel = document.createElement('section');
        const input = document.createElement('input');
        const list = document.createElement('div');
        panel.append(input, list);
        input.value = 'sonnet';
        renderAgentPickerSkeleton(list);
        const loaded = document.createElement('button');
        loaded.textContent = 'Claude Sonnet';

        replaceAgentPickerLoading(list, loaded);

        expect(list.getAttribute('aria-busy')).to.equal('false');
        expect(list.querySelector('.theia-qaap-agent-sheet-skeleton')).to.equal(null);
        expect(list.firstElementChild).to.equal(loaded);
        expect(input.value).to.equal('sonnet');
    });

    it('replaces the skeleton with a retryable error', () => {
        const list = document.createElement('div');
        let retries = 0;
        renderAgentPickerSkeleton(list);
        renderAgentPickerLoadError(list, () => retries++);

        expect(list.getAttribute('aria-busy')).to.equal('false');
        expect(list.querySelector('.theia-qaap-agent-sheet-skeleton')).to.equal(null);
        expect(list.querySelector('[role="alert"]')).to.not.equal(null);
        list.querySelector<HTMLButtonElement>('.theia-qaap-agent-sheet-retry')?.click();
        expect(retries).to.equal(1);
    });

    it('defines shimmer and disables it for reduced motion', () => {
        const cssPath = path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'mobile-workbench.css');
        const css = fs.readFileSync(cssPath, 'utf8');
        expect(css).to.include('@keyframes theia-qaap-agent-skeleton-shimmer');
        expect(css).to.include('@media (prefers-reduced-motion: reduce)');
        expect(css).to.match(/prefers-reduced-motion:[\s\S]*?animation:\s*none/);
    });
});

