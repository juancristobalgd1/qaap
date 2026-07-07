// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { isPreviewShareExpired, type QaapPreviewShareEntry } from './qaap-preview-share-store';

describe('isPreviewShareExpired (H2)', () => {
    const TTL = 24 * 60 * 60_000;
    const base = { token: 't', port: 5173 } as const;

    function entry(partial: Partial<QaapPreviewShareEntry>): QaapPreviewShareEntry {
        return { ...base, createdAt: new Date(0).toISOString(), ...partial };
    }

    it('is not expired before expiresAt', () => {
        const e = entry({ createdAt: new Date(1_000).toISOString(), expiresAt: new Date(10_000).toISOString() });
        expect(isPreviewShareExpired(e, 5_000, TTL)).to.equal(false);
    });

    it('is expired at/after expiresAt', () => {
        const e = entry({ expiresAt: new Date(10_000).toISOString() });
        expect(isPreviewShareExpired(e, 10_000, TTL)).to.equal(true);
        expect(isPreviewShareExpired(e, 10_001, TTL)).to.equal(true);
    });

    it('treats a legacy entry (no expiresAt) as createdAt + TTL', () => {
        const e = entry({ createdAt: new Date(0).toISOString() }); // expires at TTL
        expect(isPreviewShareExpired(e, TTL - 1, TTL)).to.equal(false);
        expect(isPreviewShareExpired(e, TTL, TTL)).to.equal(true);
    });

    it('does not treat an unparseable date as expired (fails open on parse, closed via other checks)', () => {
        const e = entry({ createdAt: 'not-a-date', expiresAt: 'also-bad' });
        expect(isPreviewShareExpired(e, Date.now(), TTL)).to.equal(false);
    });
});
