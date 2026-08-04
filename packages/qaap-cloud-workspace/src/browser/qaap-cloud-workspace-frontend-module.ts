// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import '../../src/browser/style/qaap-cloud.css';

import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution } from '@theia/core/lib/common/command';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { bindToolProvider } from '@theia/ai-core/lib/common/tool-invocation-registry';
import { QaapCloudBootstrapUiContribution } from './qaap-cloud-bootstrap-ui-contribution';
import { QaapAgentRunnerWarmContribution } from './qaap-agent-runner-warm-contribution';
import { QaapDeployCloudflareTool, QaapDeployVercelTool } from './qaap-deploy-tool-providers';
import { QaapTerminalPersistenceContribution } from './qaap-terminal-persistence-contribution';
import { QaapWebPushContribution } from './qaap-web-push-contribution';
import { QaapHubActionsContribution } from './qaap-hub-actions-contribution';
import { QaapHubChatSyncContribution } from './qaap-hub-chat-sync-contribution';
import { QaapMissionUndoContribution } from './qaap-mission-undo-contribution';
import { QaapWorkspaceIsolationContribution } from './qaap-workspace-isolation-contribution';
import {
    WorkspaceHandlingContribution,
    WorkspaceOpenHandlerContribution,
} from '@theia/workspace/lib/browser';

export default new ContainerModule(bind => {
    bind(QaapCloudBootstrapUiContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapCloudBootstrapUiContribution);
    bind(CommandContribution).toService(QaapCloudBootstrapUiContribution);

    bind(QaapAgentRunnerWarmContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapAgentRunnerWarmContribution);

    bind(QaapTerminalPersistenceContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapTerminalPersistenceContribution);

    bind(QaapWebPushContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapWebPushContribution);

    bind(QaapHubActionsContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(QaapHubActionsContribution);
    bind(FrontendApplicationContribution).toService(QaapHubActionsContribution);

    bind(QaapHubChatSyncContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapHubChatSyncContribution);

    bind(QaapMissionUndoContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(QaapMissionUndoContribution);

    bindToolProvider(QaapDeployVercelTool, bind);
    bindToolProvider(QaapDeployCloudflareTool, bind);

    bind(QaapWorkspaceIsolationContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapWorkspaceIsolationContribution);
    bind(WorkspaceOpenHandlerContribution).toService(QaapWorkspaceIsolationContribution);
    bind(WorkspaceHandlingContribution).toService(QaapWorkspaceIsolationContribution);
});
