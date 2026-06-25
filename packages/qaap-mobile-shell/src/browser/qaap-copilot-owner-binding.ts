// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
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

    @inject(CopilotAuthService)
    protected readonly authService: CopilotAuthService;

    onStart(): void {
        const user = readQaapAuthUser();
        this.authService.setOwnerLogin(user?.login);
    }
}
