// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
const disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import { Container } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ContributionFilterRegistry, FilterContribution } from '@theia/core/lib/common/contribution-filter/contribution-filter';
import { ContributionFilterRegistryImpl } from '@theia/core/lib/common/contribution-filter/contribution-filter-registry';
import { QaapResolveMcpContributionFilter } from './qaap-resolve-mcp-contribution-filter';

disableJSDOM();

/** Same constructor name as the api-samples class, which the product cannot import. */
class ResolveMcpFrontendContribution implements FrontendApplicationContribution {
    readonly started: string[] = [];
    onStart(): void {
        this.started.push('github token quick input');
    }
}

class OtherFrontendContribution implements FrontendApplicationContribution {
    readonly started: string[] = [];
    onStart(): void {
        this.started.push('other');
    }
}

describe('QaapResolveMcpContributionFilter', () => {

    function createRegistry(): ContributionFilterRegistry {
        const container = new Container();
        container.bind(ContributionFilterRegistry).to(ContributionFilterRegistryImpl).inSingletonScope();
        container.bind(FilterContribution).to(QaapResolveMcpContributionFilter).inSingletonScope();
        return container.get<ContributionFilterRegistry>(ContributionFilterRegistry);
    }

    it('removes the api-samples GitHub token prompt from the FrontendApplicationContributions', async () => {
        const registry = createRegistry();
        const prompt = new ResolveMcpFrontendContribution();
        const other = new OtherFrontendContribution();
        const remaining = registry.applyFilters<FrontendApplicationContribution>([prompt, other], FrontendApplicationContribution);
        expect(remaining).to.deep.equal([other]);
        // Starting the remaining contributions never reaches the quick input.
        for (const contribution of remaining) {
            contribution.onStart?.({} as never);
        }
        expect(prompt.started).to.deep.equal([]);
        expect(other.started).to.deep.equal(['other']);
    });

    it('keeps every contribution when the api-samples prompt is not present', () => {
        const registry = createRegistry();
        const other = new OtherFrontendContribution();
        expect(registry.applyFilters<FrontendApplicationContribution>([other], FrontendApplicationContribution)).to.deep.equal([other]);
    });

    it('matches by constructor name only', () => {
        expect(QaapResolveMcpContributionFilter.isResolveMcpContribution(new ResolveMcpFrontendContribution())).to.equal(true);
        expect(QaapResolveMcpContributionFilter.isResolveMcpContribution(new OtherFrontendContribution())).to.equal(false);
    });
});
