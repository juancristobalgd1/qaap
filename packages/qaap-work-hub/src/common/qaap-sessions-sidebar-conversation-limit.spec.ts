// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    QAAP_SESSIONS_SIDEBAR_CONVERSATIONS_COLLAPSED_LIMIT,
    resolveSessionsSidebarInitialConversationLimit,
} from './qaap-sessions-sidebar-conversation-limit';

describe('qaap-sessions-sidebar-conversation-limit', () => {
    it('keeps the compact default when multiple projects are visible', () => {
        expect(resolveSessionsSidebarInitialConversationLimit({
            projectCount: 2,
            totalConversations: 30,
            viewportHeight: 1200,
        })).to.equal(QAAP_SESSIONS_SIDEBAR_CONVERSATIONS_COLLAPSED_LIMIT);
    });

    it('boosts the initial visible count for a single project on tall viewports', () => {
        const limit = resolveSessionsSidebarInitialConversationLimit({
            projectCount: 1,
            totalConversations: 40,
            viewportHeight: 1200,
        });
        expect(limit).to.be.greaterThan(QAAP_SESSIONS_SIDEBAR_CONVERSATIONS_COLLAPSED_LIMIT);
        expect(limit).to.be.at.most(40);
    });

    it('never exceeds the total conversation count', () => {
        expect(resolveSessionsSidebarInitialConversationLimit({
            projectCount: 1,
            totalConversations: 7,
            viewportHeight: 1200,
        })).to.equal(7);
    });
});
