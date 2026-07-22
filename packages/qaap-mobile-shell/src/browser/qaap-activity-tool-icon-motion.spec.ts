// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { expect } from 'chai';
import {
    ACTIVITY_TOOL_ICON_MOTION_CLASS,
    activityToolIconMotionKindClass,
    clearActivityToolIconMotion,
    resolveActivityToolIconMotionKind,
    syncActivityToolIconMotion,
} from './qaap-activity-tool-icon-motion';

describe('qaap-activity-tool-icon-motion', () => {
    it('maps edit / write / search / read / update tool kinds', () => {
        expect(resolveActivityToolIconMotionKind('editing')).to.equal('edit');
        expect(resolveActivityToolIconMotionKind('edit')).to.equal('edit');
        expect(resolveActivityToolIconMotionKind('write')).to.equal('write');
        expect(resolveActivityToolIconMotionKind('searching')).to.equal('search');
        expect(resolveActivityToolIconMotionKind('explore')).to.equal('search');
        expect(resolveActivityToolIconMotionKind('reading')).to.equal('read');
        expect(resolveActivityToolIconMotionKind('read')).to.equal('read');
        expect(resolveActivityToolIconMotionKind('update')).to.equal('update');
        expect(resolveActivityToolIconMotionKind('retrying')).to.equal('update');
        expect(resolveActivityToolIconMotionKind('terminal')).to.equal('run');
        expect(resolveActivityToolIconMotionKind('run')).to.equal('run');
        expect(resolveActivityToolIconMotionKind('thinking')).to.equal(undefined);
        expect(resolveActivityToolIconMotionKind('writing')).to.equal(undefined);
    });

    it('applies motion classes while active and clears when settled', () => {
        const icon = document.createElement('span');
        icon.className = 'codicon codicon-edit theia-mobile-tool-group-icon';

        syncActivityToolIconMotion(icon, true, 'edit');
        expect(icon.classList.contains(ACTIVITY_TOOL_ICON_MOTION_CLASS)).to.equal(true);
        expect(icon.classList.contains(activityToolIconMotionKindClass('edit'))).to.equal(true);

        syncActivityToolIconMotion(icon, true, 'edit');
        expect(icon.classList.contains(ACTIVITY_TOOL_ICON_MOTION_CLASS)).to.equal(true);

        syncActivityToolIconMotion(icon, false, 'edit');
        expect(icon.classList.contains(ACTIVITY_TOOL_ICON_MOTION_CLASS)).to.equal(false);
        expect(icon.classList.contains(activityToolIconMotionKindClass('edit'))).to.equal(false);
    });

    it('switches motion kind without leaving stale kind classes', () => {
        const icon = document.createElement('span');
        syncActivityToolIconMotion(icon, true, 'search');
        syncActivityToolIconMotion(icon, true, 'read');
        expect(icon.classList.contains(activityToolIconMotionKindClass('search'))).to.equal(false);
        expect(icon.classList.contains(activityToolIconMotionKindClass('read'))).to.equal(true);
        clearActivityToolIconMotion(icon);
        expect(icon.classList.contains(ACTIVITY_TOOL_ICON_MOTION_CLASS)).to.equal(false);
    });

    it('does not apply motion when prefers-reduced-motion is enabled', () => {
        const matchMedia = window.matchMedia;
        window.matchMedia = ((query: string) => ({
            matches: query.includes('prefers-reduced-motion'),
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        })) as typeof window.matchMedia;
        try {
            const icon = document.createElement('span');
            syncActivityToolIconMotion(icon, true, 'edit');
            expect(icon.classList.contains(ACTIVITY_TOOL_ICON_MOTION_CLASS)).to.equal(false);
        } finally {
            window.matchMedia = matchMedia;
        }
    });
});
