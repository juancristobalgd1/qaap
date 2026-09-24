// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    applyAiSettingsOverlay,
    collectAiSettingsForPersist,
    overlayPrefGet,
    shouldInterceptSharedUserAiPrefWrites,
} from './qaap-user-ai-settings-overlay';

describe('Qaap user AI settings overlay', () => {

    it('intercepts writes for authenticated GitHub/GitLab logins', () => {
        expect(shouldInterceptSharedUserAiPrefWrites('alice')).to.equal(true);
        expect(shouldInterceptSharedUserAiPrefWrites('bob-org')).to.equal(true);
    });

    it('keeps shared User scope for skip-auth and anonymous buckets', () => {
        expect(shouldInterceptSharedUserAiPrefWrites(undefined)).to.equal(false);
        expect(shouldInterceptSharedUserAiPrefWrites('')).to.equal(false);
        expect(shouldInterceptSharedUserAiPrefWrites('_dev')).to.equal(false);
        expect(shouldInterceptSharedUserAiPrefWrites('_anonymous')).to.equal(false);
    });

    it('hydrates only AI pref keys into the overlay', () => {
        const overlay = new Map<string, unknown>();
        const applied = applyAiSettingsOverlay(
            overlay,
            {
                'ai-features.openrouter.openrouterApiKey': 'sk-a',
                'editor.fontSize': 14,
            },
            name => name.startsWith('ai-features.'),
        );
        expect(applied).to.deep.equal(['ai-features.openrouter.openrouterApiKey']);
        expect(overlay.get('ai-features.openrouter.openrouterApiKey')).to.equal('sk-a');
        expect(overlay.has('editor.fontSize')).to.equal(false);
    });

    it('prefers overlay values over the shared PreferenceService fallback', () => {
        const overlay = new Map<string, unknown>([
            ['ai-features.openrouter.openrouterApiKey', 'sk-overlay'],
        ]);
        expect(overlayPrefGet(overlay, 'ai-features.openrouter.openrouterApiKey', () => 'sk-shared'))
            .to.equal('sk-overlay');
        expect(overlayPrefGet(overlay, 'editor.fontSize', () => 12)).to.equal(12);
    });

    it('persists overlay keys without reading another tenant from fallback', () => {
        const overlay = new Map<string, unknown>([
            ['ai-features.openrouter.openrouterApiKey', 'sk-alice'],
        ]);
        const persisted = collectAiSettingsForPersist(
            overlay,
            ['ai-features.openrouter.openrouterApiKey', 'ai-features.openrouter.openrouterModels'],
            key => key === 'ai-features.openrouter.openrouterApiKey' ? 'sk-shared-leak' : undefined,
        );
        expect(persisted).to.deep.equal({
            'ai-features.openrouter.openrouterApiKey': 'sk-alice',
        });
    });
});
