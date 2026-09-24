// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    shouldActivateTerminalLink,
    touchEndInfo,
    wasRecentTap,
    TouchEndInfo
} from './qaap-terminal-link-activation';

describe('shouldActivateTerminalLink', () => {

    it('opens on Cmd/Ctrl+click (desktop standard)', () => {
        expect(shouldActivateTerminalLink({
            modifierKeyDown: true,
            touchPrimaryDevice: false,
            recentTouch: false
        })).to.equal(true);
    });

    it('does NOT open on a plain desktop click (protects text selection)', () => {
        expect(shouldActivateTerminalLink({
            modifierKeyDown: false,
            touchPrimaryDevice: false,
            recentTouch: false
        })).to.equal(false);
    });

    it('opens on a tap on a touch-primary device even without a matched click', () => {
        expect(shouldActivateTerminalLink({
            modifierKeyDown: false,
            touchPrimaryDevice: true,
            recentTouch: false
        })).to.equal(true);
    });

    it('opens on a hybrid device when the click came from a recent tap', () => {
        expect(shouldActivateTerminalLink({
            modifierKeyDown: false,
            touchPrimaryDevice: false,
            recentTouch: true
        })).to.equal(true);
    });
});

describe('wasRecentTap', () => {

    const touch = (over: Partial<TouchEndInfo> = {}): TouchEndInfo => ({
        timeStamp: 1000,
        pageX: 100,
        pageY: 200,
        ...over
    });

    it('returns false when there was no touchend', () => {
        expect(wasRecentTap({ timeStamp: 1050, pageX: 100, pageY: 200 }, undefined)).to.equal(false);
    });

    it('matches a synthetic click that follows the touch within the window and near the point', () => {
        expect(wasRecentTap({ timeStamp: 1050, pageX: 101, pageY: 199 }, touch())).to.equal(true);
    });

    it('rejects a click that is too far in time from the touch (stale touch)', () => {
        // 2000ms after the touchend — well beyond the 1200ms window.
        expect(wasRecentTap({ timeStamp: 3000, pageX: 100, pageY: 200 }, touch())).to.equal(false);
    });

    it('rejects a click that lands far from the touch point', () => {
        expect(wasRecentTap({ timeStamp: 1050, pageX: 400, pageY: 200 }, touch())).to.equal(false);
    });

    it('still matches on time alone when the touch coordinates are unavailable', () => {
        // Reproduces the real bug: a TouchEvent exposes coords via changedTouches,
        // not at the top level, so the distance guard must not reject when the
        // point is unknown.
        expect(wasRecentTap({ timeStamp: 1050, pageX: 100, pageY: 200 }, touch({ pageX: undefined, pageY: undefined }))).to.equal(true);
    });

    it('rejects a touch that happened AFTER the click (unrelated)', () => {
        expect(wasRecentTap({ timeStamp: 900, pageX: 100, pageY: 200 }, touch())).to.equal(false);
    });

    it('honours a custom time window', () => {
        expect(wasRecentTap(
            { timeStamp: 1500, pageX: 100, pageY: 200 },
            touch(),
            { maxDelayMs: 300 }
        )).to.equal(false);
    });
});

describe('touchEndInfo', () => {

    it('reads coordinates from changedTouches[0]', () => {
        const event = {
            timeStamp: 42,
            changedTouches: [{ pageX: 12, pageY: 34 }]
        } as unknown as TouchEvent;
        expect(touchEndInfo(event)).to.deep.equal({ timeStamp: 42, pageX: 12, pageY: 34 });
    });

    it('yields undefined coordinates when there are no changed touches', () => {
        const event = {
            timeStamp: 42,
            changedTouches: [] as unknown
        } as unknown as TouchEvent;
        expect(touchEndInfo(event)).to.deep.equal({ timeStamp: 42, pageX: undefined, pageY: undefined });
    });
});
