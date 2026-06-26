// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { CopilotAuthService } from '@theia/ai-copilot/src/common/copilot-auth-service';
import { readQaapAuthUser } from '@theia/qaap-adapters/src/browser/qaap-auth-session';

/**
 * Binds the Qaap authenticated user's login to the CopilotAuthService so that
 * OAuth credentials are stored under a per-user keystore account instead of a
 * single shared entry. This prevents cross-user token leakage on a shared backend.
 */
@injectable()
export class QaapCopilotOwnerBinding implements FrontendApplicationContribution {

    protected authServiceResolver: (() => Promise<CopilotAuthService>) | undefined;

    setAuthServiceResolver(resolver: () => Promise<CopilotAuthService>): void {
        this.authServiceResolver = resolver;
    }

    onStart(): void {
        const resolver = this.authServiceResolver;
        if (!resolver) {
            console.warn('[qaap-copilot-owner-binding] CopilotAuthService resolver not configured');
            return;
        }
        const user = readQaapAuthUser();
        // CopilotAuthService is a dynamic value with async dependencies (RemoteConnectionProvider),
        // so we resolve it lazily to avoid synchronous resolution errors.
        resolver()
            .then(authService => authService.setOwnerLogin(user?.login))
            .catch(e => console.warn('[qaap-copilot-owner-binding] CopilotAuthService not available', e));
    }
}
