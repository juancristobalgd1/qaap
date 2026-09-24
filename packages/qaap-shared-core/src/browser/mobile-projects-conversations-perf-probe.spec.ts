// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { QAAP_WORK_HUB_PERF_PROBE_SESSION_KEY } from '../common/qaap-work-hub-perf-probe';
import { buildProbeStreamingSummaries } from './qaap-work-hub-perf-probe-host';
import type { MobileProjectsConversations } from './mobile-projects-conversations';

describe('MobileProjectsConversations perf probe', () => {

    let disableJSDOM: (() => void) | undefined;
    let conversationsCtor: typeof MobileProjectsConversations;

    before(() => {
        disableJSDOM = enableJSDOM();
        // Import after JSDOM — MobileProjectsConversations pulls browser modules that need `document`.
        conversationsCtor = require('./mobile-projects-conversations').MobileProjectsConversations;
    });

    after(() => {
        disableJSDOM?.();
    });

    beforeEach(() => {
        window.sessionStorage.setItem(QAAP_WORK_HUB_PERF_PROBE_SESSION_KEY, '1');
    });

    it('keeps probe summaries after applyConversationGroups clears live buckets', () => {
        const conversations = new conversationsCtor() as MobileProjectsConversations & {
            applyConversationGroups(
                groups: ReadonlyArray<{ readonly cwd: string; readonly conversations: ReadonlyArray<unknown> }>,
            ): void;
        };
        const cwd = '/workspace/cloud-ws-demo';
        conversations.perfProbeSeedSummaries(cwd, buildProbeStreamingSummaries(cwd));
        expect(conversations.getConversationsForCwd(cwd)).to.have.length(3);

        conversations.applyConversationGroups([]);
        expect(conversations.getConversationsForCwd(cwd)).to.have.length(3);
    });
});
