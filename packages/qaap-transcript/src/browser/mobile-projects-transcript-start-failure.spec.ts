// *****************************************************************************
// Copyright (C) 2026 Qaap and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveMobileClosingNarrativeActionExtracted } from './mobile-projects-transcript-messages-artifacts-ui-render';
import type { MobileProjectsTranscriptMessagesArtifactsUiContext } from './mobile-projects-transcript-messages-artifacts-ui-context';

/** The narrative resolver reads nothing from its context, so an empty one is enough. */
const context = {} as MobileProjectsTranscriptMessagesArtifactsUiContext;
const NO_SEEN: ReadonlySet<string> = new Set<string>();

describe('transcript start failure', () => {
    it('renders a backend "Failed to start" line as an error card, not as an agent reply', () => {
        const action = resolveMobileClosingNarrativeActionExtracted(
            context,
            'Failed to start: cwd is owned by another user (403)',
            NO_SEEN,
            undefined,
            true,
        );
        expect(action).to.deep.equal({ kind: 'error-card', message: 'Failed to start: cwd is owned by another user (403)' });
    });

    it('still renders a normal agent reply as text', () => {
        const action = resolveMobileClosingNarrativeActionExtracted(context, 'Done. I updated the parser.', NO_SEEN, undefined, false);
        expect(action).to.deep.equal({ kind: 'text' });
    });

    it('keeps an agent reply that only mentions the phrase mid-sentence as text', () => {
        const action = resolveMobileClosingNarrativeActionExtracted(context, 'The log said Failed to start earlier.', NO_SEEN, undefined, true);
        expect(action.kind).to.equal('text');
    });
});
