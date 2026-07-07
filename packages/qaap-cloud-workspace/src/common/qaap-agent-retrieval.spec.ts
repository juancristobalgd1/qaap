// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { extractRetrievalKeywords, formatRelevantFilesHint, RETRIEVAL_MAX_KEYWORDS } from './qaap-agent-retrieval';

describe('extractRetrievalKeywords', () => {
    it('keeps identifier-ish terms and drops stopwords/boilerplate', () => {
        const kw = extractRetrievalKeywords('Fix the loginController so the sessionStore refreshes the token');
        expect(kw).to.include('loginController');
        expect(kw).to.include('sessionStore');
        expect(kw).to.include('refreshes');
        expect(kw).to.include('token');     // meaningful noun, kept
        expect(kw).to.not.include('the');
        expect(kw).to.not.include('fix');   // boilerplate verb, dropped
    });

    it('keeps dotted and snake/camel identifiers', () => {
        const kw = extractRetrievalKeywords('update qaap_agent.runner and MyWidget.tsx');
        expect(kw).to.include('qaap_agent.runner');
        expect(kw).to.include('MyWidget.tsx');
    });

    it('dedupes case-insensitively and caps the count', () => {
        const kw = extractRetrievalKeywords('alpha Alpha ALPHA beta gamma delta epsilon zeta eta theta iota kappa');
        expect(kw.filter(k => k.toLowerCase() === 'alpha')).to.have.length(1);
        expect(kw.length).to.be.at.most(RETRIEVAL_MAX_KEYWORDS);
    });

    it('returns empty for empty or stopword-only input', () => {
        expect(extractRetrievalKeywords(undefined)).to.deep.equal([]);
        expect(extractRetrievalKeywords('please fix the code for me')).to.deep.equal([]);
    });
});

describe('formatRelevantFilesHint', () => {
    it('formats paths as a bullet list', () => {
        expect(formatRelevantFilesHint(['src/a.ts', 'src/b.ts'], 400)).to.equal('- src/a.ts\n- src/b.ts');
    });

    it('respects the char budget', () => {
        const hint = formatRelevantFilesHint(['src/very-long-path-a.ts', 'src/very-long-path-b.ts', 'src/c.ts'], 30)!;
        expect(hint.length).to.be.at.most(30);
        expect(hint).to.contain('src/very-long-path-a.ts');
    });

    it('returns undefined for no paths', () => {
        expect(formatRelevantFilesHint([], 400)).to.equal(undefined);
    });
});
