// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { MobileWorkHubProfileOverview } from './mobile-work-hub-profile-overview';
import type { QaapProfileInsights } from '../common/qaap-profile-insights';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

const IDENTITY = { name: 'Juan Cristobal', detail: '@juan', avatarUrl: 'https://example.test/a.png', initials: 'JC', providerLabel: 'GitHub' };

const INSIGHTS: QaapProfileInsights = {
    tasks: 267,
    messages: 900,
    projects: 4,
    currentStreakDays: 1,
    longestStreakDays: 7,
    peakDay: { day: new Date(2026, 10, 15).getTime(), tasks: 12 },
    mostActiveHour: 23,
    harnesses: [{ agentId: 'codex', tasks: 2, share: 0.5 }, { agentId: 'claude', tasks: 2, share: 0.5 }],
    models: [
        { agentId: 'cursor', modelId: 'composer-2.5', tasks: 1, share: 0.5 },
        { agentId: 'codex', modelId: 'gpt-6-astra', tasks: 1, share: 0.5 },
    ],
};

describe('MobileWorkHubProfileOverview', () => {
    useSuiteJSDOM();

    const stat = (overview: MobileWorkHubProfileOverview, key: string): string | null | undefined =>
        overview.node.querySelector(`[data-stat="${key}"] .qaap-profile-overview-stat-value`)?.textContent;

    it('centers the account: avatar, name, login and provider', () => {
        const overview = new MobileWorkHubProfileOverview(IDENTITY, true);
        expect(overview.node.querySelector<HTMLImageElement>('.qaap-profile-overview-avatar img')?.src).to.equal(IDENTITY.avatarUrl);
        expect(overview.node.querySelector('.qaap-profile-overview-name')?.textContent).to.equal('Juan Cristobal');
        expect(overview.node.querySelector('.qaap-profile-overview-login')?.textContent).to.equal('@juan');
        expect(overview.node.querySelector('.qaap-profile-overview-provider')?.textContent).to.equal('GitHub');
    });

    it('shows initials without an avatar, and no numbers without an account', () => {
        const overview = new MobileWorkHubProfileOverview({ ...IDENTITY, avatarUrl: undefined }, false);
        expect(overview.node.querySelector('.qaap-profile-overview-avatar')?.textContent).to.equal('JC');
        expect(overview.node.querySelector('.qaap-profile-overview-stats')).to.equal(null);
    });

    it('fills the headline numbers, insights and model usage once the history loads', () => {
        const overview = new MobileWorkHubProfileOverview(IDENTITY, true);
        expect(stat(overview, 'tasks')).to.equal('—');
        overview.setInsights(INSIGHTS);
        overview.setTokens(1_250_000);
        expect(stat(overview, 'tasks')).to.equal('267');
        expect(stat(overview, 'current')).to.equal('1 day');
        expect(stat(overview, 'longest')).to.equal('7 days');
        expect(stat(overview, 'tokens')).to.not.equal('—');
        const insights = overview.node.querySelector('.qaap-profile-overview-insights')!.textContent!;
        expect(insights).to.contain('50%');
        const models = Array.from(overview.node.querySelectorAll('.qaap-profile-overview-model'));
        expect(models).to.have.length(2);
        expect(models[0].querySelector('.qaap-profile-overview-model-share')?.textContent).to.equal('50%');
        expect(models[0].querySelector<HTMLElement>('.qaap-profile-overview-model-fill')!.style.getPropertyValue('--qaap-profile-share')).to.equal('50%');
    });

    it('says when no model has been used yet, and when the history cannot be read', () => {
        const overview = new MobileWorkHubProfileOverview(IDENTITY, true);
        overview.setInsights({ ...INSIGHTS, models: [] });
        expect(overview.node.querySelector('.qaap-profile-overview-models')).to.equal(null);
        expect(overview.node.querySelector('.qaap-profile-overview-details .qaap-profile-overview-empty')).to.not.equal(null);
        overview.showHistoryError();
        expect(stat(overview, 'tasks')).to.equal('—');
        expect(overview.node.querySelector('.qaap-profile-overview-details')!.textContent).to.contain('could not be loaded');
    });

    it('lists the most used skills and tools, and hides the section without data', () => {
        const overview = new MobileWorkHubProfileOverview(IDENTITY, true);
        overview.setInsights(INSIGHTS);
        const tools = overview.node.querySelector<HTMLElement>('.qaap-profile-overview-tools')!;
        expect(tools.hidden, 'hidden until the usage loads').to.equal(true);
        overview.setToolUsage([{ name: '$checkout', kind: 'skill', runs: 56 }, { name: 'github', kind: 'mcp', runs: 1 }]);
        expect(tools.hidden).to.equal(false);
        const rows = Array.from(tools.querySelectorAll('.qaap-profile-overview-tool'));
        expect(rows.map(row => row.querySelector('.qaap-profile-overview-tool-name')?.textContent)).to.deep.equal(['$checkout', 'github']);
        expect(rows[0].querySelector('.qaap-profile-overview-tool-runs')?.textContent).to.equal('56 runs');
        expect(rows[1].querySelector('.qaap-profile-overview-tool-runs')?.textContent).to.equal('1 run');
        overview.setToolUsage(undefined);
        expect(tools.hidden).to.equal(true);
        expect(overview.node.querySelector('.qaap-profile-overview-models')!.closest('.qaap-profile-overview-wide')).to.not.equal(null);
    });
});
