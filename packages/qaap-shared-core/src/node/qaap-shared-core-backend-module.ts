// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { bindRootContributionProvider } from '@theia/core/lib/common/contribution-provider';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { PreferenceContribution } from '@theia/core/lib/common/preferences/preference-schema';
import { QaapPiProviderPreferencesSchema } from '../common/qaap-pi-provider-preferences';
import { QaapClientErrorEndpoint } from './qaap-client-error-endpoint';
import { QaapFrameCheckEndpoint } from './qaap-frame-check-endpoint';
import { QaapApiRateLimitContribution } from './qaap-api-rate-limit';
import { QaapDevPreviewEndpoint } from './qaap-dev-preview-endpoint';
import { QaapDevPreviewPortRegistry } from './qaap-dev-preview-port-registry';
import { QaapGithubAuthGuard } from './qaap-github-auth-guard';
import { QaapGithubInboxEndpoint } from './qaap-github-inbox-endpoint';
import { QaapGithubInboxHub } from './qaap-github-inbox-hub';
import { QaapGithubOauthEndpoint } from './qaap-github-oauth-endpoint';
import { QaapHealthCheckContribution } from './qaap-health-check-contribution';
import { QaapMissingCloneRecovery } from './qaap-missing-clone-recovery';
import { QaapGithubWorkspaceJobRegistry } from './qaap-github-workspace-jobs';
import { QaapHostedGitFetch } from './qaap-hosted-git-fetch';
import { QaapHostedGitPush } from './qaap-hosted-git-push';
import { QaapHostedWorktreeRegistry } from './qaap-hosted-worktree-registry';
import { QaapHostedProjectResolver } from './qaap-hosted-project-resolver';
import { QaapGithubOwnerTokenCache } from './qaap-github-owner-token-cache';
import { QaapApiTokenEndpoint } from './qaap-api-token-endpoint';
import { QaapApiTokenStore } from './qaap-api-token-store';
import { QaapGithubSessionStore } from './qaap-github-session-store';
import { QaapGithubWebhookListener } from './qaap-github-webhook-listener';
import { QaapLegacyGitCredentialCleanup } from './qaap-legacy-git-credential-cleanup';
import { QaapProjectSessionStore } from './qaap-project-session-store';
import { QaapProductionBootGuardContribution } from './qaap-production-boot-guard';
import { QaapRepositoryRemovalContribution } from './qaap-repository-removal-contribution';

export default new ContainerModule(bind => {
    bind(QaapProductionBootGuardContribution).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapProductionBootGuardContribution);
    bind(QaapGithubSessionStore).toSelf().inSingletonScope();
    bind(QaapApiTokenStore).toSelf().inSingletonScope();
    bind(QaapApiTokenEndpoint).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapApiTokenEndpoint);
    bind(QaapLegacyGitCredentialCleanup).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapLegacyGitCredentialCleanup);
    bind(QaapGithubAuthGuard).toSelf().inSingletonScope();
    bind(QaapGithubInboxHub).toSelf().inSingletonScope();
    bind(QaapGithubInboxEndpoint).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapGithubInboxEndpoint);
    bindRootContributionProvider(bind, QaapGithubWebhookListener);
    bind(QaapProjectSessionStore).toSelf().inSingletonScope();
    bindRootContributionProvider(bind, QaapRepositoryRemovalContribution);
    bindRootContributionProvider(bind, QaapHealthCheckContribution);
    bind(QaapGithubWorkspaceJobRegistry).toSelf().inSingletonScope();
    // Sealed GitHub git as the backend uid; shared by the GitHub open/clone flow and the git-review push.
    bind(QaapHostedGitFetch).toSelf().inSingletonScope();
    bind(QaapHostedGitPush).toSelf().inSingletonScope();
    bind(QaapHostedWorktreeRegistry).toSelf().inSingletonScope();
    bind(QaapHostedProjectResolver).toSelf().inSingletonScope();
    bind(QaapGithubOwnerTokenCache).toSelf().inSingletonScope();
    bind(QaapGithubOauthEndpoint).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapGithubOauthEndpoint);
    bind(QaapMissingCloneRecovery).toSelf().inSingletonScope();
    bind(QaapDevPreviewPortRegistry).toSelf().inSingletonScope();
    bind(QaapDevPreviewEndpoint).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapDevPreviewEndpoint);
    bind(QaapFrameCheckEndpoint).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapFrameCheckEndpoint);
    bind(QaapApiRateLimitContribution).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapApiRateLimitContribution);
    bind(QaapClientErrorEndpoint).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapClientErrorEndpoint);
    // Pi provider keys: the backend reads them through the schema defaults of per-user settings.
    bind(PreferenceContribution).toConstantValue({ schema: QaapPiProviderPreferencesSchema });
});
