// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { MobileProjectsStickyComposerColumnUi, type MobileProjectsStickyComposerColumnHost } from './mobile-projects-sticky-composer-column-ui';

type ColumnOptions = Parameters<MobileProjectsStickyComposerColumnUi['buildStickyComposerColumn']>[0];

/**
 * While a turn runs, the composer input panel carries the working class that drives the border beam.
 * The beam itself is painted by the transcript stylesheet; this spec guards both halves.
 */
describe('sticky composer working effect', () => {
    let disableJSDOM: () => void;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
    });

    afterEach(() => {
        document.body.replaceChildren();
        disableJSDOM();
    });

    function buildColumn(working: boolean, beamIdle = false): HTMLElement {
        const host = {
            stickyComposerAgentsUi: {
                isAgentDisconnected: () => false,
                resolveModelLabel: () => '',
                resolveStickyComposerAgentModel: () => undefined,
                warmModelLabels: () => undefined,
            },
        } as unknown as MobileProjectsStickyComposerColumnHost;
        const options = {
            project: { id: 'p', uri: 'file:///p' },
            getContext: () => [],
            clearContext: () => undefined,
            removeContextItem: () => undefined,
            formatContextChip: () => ({ label: '', title: '' }),
            getDraft: () => '',
            setDraft: () => undefined,
            onAttach: () => undefined,
            onOpenAgentSheet: () => undefined,
            resolveAgentLabel: () => 'Claude',
            resolveAgentId: () => 'claude',
            canSubmit: true,
            isAgentWorking: () => working,
            isAgentBeamIdle: () => beamIdle,
        } as unknown as ColumnOptions;
        return new MobileProjectsStickyComposerColumnUi(host).buildStickyComposerColumn(options);
    }

    it('marks the input panel with the working class while a turn runs', () => {
        const column = buildColumn(true);
        const panel = column.querySelector('.theia-mobile-projects-sticky-composer-input-panel');
        expect(panel?.classList.contains('theia-mod-agent-working')).to.equal(true);
        expect(panel?.classList.contains('theia-mod-agent-working-idle')).to.equal(false);
    });

    it('switches to the idle beam class when the beam is idle during a turn', () => {
        const panel = buildColumn(true, true).querySelector('.theia-mobile-projects-sticky-composer-input-panel');
        expect(panel?.classList.contains('theia-mod-agent-working')).to.equal(false);
        expect(panel?.classList.contains('theia-mod-agent-working-idle')).to.equal(true);
    });

    it('carries no working class when no turn runs', () => {
        const panel = buildColumn(false).querySelector('.theia-mobile-projects-sticky-composer-input-panel');
        expect(panel?.classList.contains('theia-mod-agent-working')).to.equal(false);
    });

    it('has its beam stylesheet rules in the transcript styles', () => {
        const css = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', 'qaap-transcript', 'src', 'browser', 'style', 'mobile-workbench-transcript.css'),
            'utf8',
        );
        expect(css).to.match(/\.theia-mobile-projects-sticky-composer-input-panel\.theia-mod-agent-working\s+\.qaap-border-beam-bloom/);
        expect(css).to.match(/\.theia-mobile-projects-sticky-composer-card\.theia-mod-has-context:has\(\.theia-mobile-projects-sticky-composer-input-panel\.theia-mod-agent-working\)\s+\.qaap-card-beam-bloom/);
    });
});
