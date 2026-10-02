// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    ComposerSheetRenderDeferral,
    isComposerSheetOpen,
    type ComposerRenderKind,
    type ComposerSheetSlots,
} from './qaap-composer-sheet-render-deferral';

describe('qaap-composer-sheet-render-deferral', () => {

    const element = (isConnected: boolean): HTMLElement => ({ isConnected } as unknown as HTMLElement);

    it('treats only a connected sheet slot as open', () => {
        expect(isComposerSheetOpen({})).to.equal(false);
        expect(isComposerSheetOpen({ stickyComposerModeSheet: element(false) })).to.equal(false);
        expect(isComposerSheetOpen({ stickyComposerModeSheet: element(true) })).to.equal(true);
        expect(isComposerSheetOpen({ transcriptComposerApprovalSheet: element(true) })).to.equal(true);
        expect(isComposerSheetOpen({ transcriptComposerAgentSheet: element(true) })).to.equal(true);
    });

    function createDeferral(slots: { -readonly [K in keyof ComposerSheetSlots]: ComposerSheetSlots[K] }): {
        readonly deferral: ComposerSheetRenderDeferral;
        readonly replays: ComposerRenderKind[];
        readonly runQueued: () => void;
    } {
        const replays: ComposerRenderKind[] = [];
        const queued: Array<() => void> = [];
        const deferral = new ComposerSheetRenderDeferral(
            () => isComposerSheetOpen(slots),
            kind => replays.push(kind),
            task => queued.push(task),
        );
        return { deferral, replays, runQueued: () => queued.splice(0).forEach(task => task()) };
    }

    it('skips a background re-render while the Mode picker is open and replays it after it closes', () => {
        const slots: { stickyComposerModeSheet?: HTMLElement } = { stickyComposerModeSheet: element(true) };
        const { deferral, replays, runQueued } = createDeferral(slots);

        // A poll / status tick asks for a rebuild: it must not run (it would detach the anchor).
        expect(deferral.defer('render')).to.equal(true);
        expect(deferral.defer('remount')).to.equal(true);
        deferral.scheduleFlush();
        runQueued();
        expect(replays).to.deep.equal([], 'nothing replays while the picker is still open');

        // User clicks outside: the sheet closes, then the deferred rebuilds run once.
        slots.stickyComposerModeSheet = undefined;
        deferral.scheduleFlush();
        deferral.scheduleFlush();
        runQueued();
        expect(replays).to.deep.equal(['remount', 'render']);
        deferral.scheduleFlush();
        runQueued();
        expect(replays).to.deep.equal(['remount', 'render'], 'a flush replays each kind at most once');
    });

    it('lets renders through when no sheet is open and drops a superseded pending replay', () => {
        const slots: { stickyComposerAgentSheet?: HTMLElement } = { stickyComposerAgentSheet: element(true) };
        const { deferral, replays, runQueued } = createDeferral(slots);
        expect(deferral.defer('render')).to.equal(true);

        // Picker handler: close the sheet, then render right away (user-initiated path).
        slots.stickyComposerAgentSheet = undefined;
        deferral.scheduleFlush();
        expect(deferral.defer('render')).to.equal(false);
        runQueued();
        expect(replays).to.deep.equal([], 'the synchronous render already superseded the queued one');
        expect(deferral.hasPending()).to.equal(false);
    });
});
