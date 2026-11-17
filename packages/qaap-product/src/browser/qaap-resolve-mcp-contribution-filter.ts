// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ContributionFilterRegistry, FilterContribution } from '@theia/core/lib/common/contribution-filter/contribution-filter';

/**
 * Constructor name of the `@theia/api-samples` contribution that asks for a GitHub token on every start
 * (`examples/api-samples/src/browser/mcp/resolve-frontend-mcp-contribution.ts`). The example apps depend on
 * api-samples, so the product cannot import the class; it is matched by name instead.
 */
export const QAAP_RESOLVE_MCP_CONTRIBUTION_NAME = 'ResolveMcpFrontendContribution';

/**
 * Removes the api-samples GitHub token prompt from the frontend application contributions, in the browser
 * and in Electron alike. The product never wants a quick input at startup for an MCP token.
 *
 * Matching by constructor name is fragile when a build minifies class names. Keep this filter in sync with
 * the api-samples class name, and check it after changing the bundler configuration.
 */
@injectable()
export class QaapResolveMcpContributionFilter implements FilterContribution {

    registerContributionFilters(registry: ContributionFilterRegistry): void {
        registry.addFilters([FrontendApplicationContribution], [
            contribution => !QaapResolveMcpContributionFilter.isResolveMcpContribution(contribution)
        ]);
    }

    /** Whether the instance is the api-samples GitHub token prompt. */
    static isResolveMcpContribution(contribution: object): boolean {
        return contribution.constructor?.name === QAAP_RESOLVE_MCP_CONTRIBUTION_NAME;
    }
}
