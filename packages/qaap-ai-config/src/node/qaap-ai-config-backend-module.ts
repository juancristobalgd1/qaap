// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { PreferenceContribution } from '@theia/core/lib/common/preferences/preference-schema';
import { ShellExecutionServerImpl } from '@theia/ai-terminal/lib/node/shell-execution-server-impl';
import { MCPFrontendContributionManager } from '@theia/ai-mcp-server/lib/node/mcp-frontend-contribution-manager';
import { QaapAiModelDefaultsContribution } from '../common/qaap-ai-model-defaults-contribution';
import { patchAnthropicModelForQaapHistory } from './qaap-anthropic-model-patch';
import { QaapMCPFrontendContributionManager } from './qaap-mcp-frontend-contribution-manager';
import { QaapShellExecutionServerImpl } from './qaap-shell-execution-server-impl';
import { ensureQaapSystemSkillsDirEnv } from './qaap-system-skills-env';

patchAnthropicModelForQaapHistory();
ensureQaapSystemSkillsDirEnv();

export default new ContainerModule((bind, unbind, isBound, rebind) => {
    rebind(ShellExecutionServerImpl).to(QaapShellExecutionServerImpl).inSingletonScope();
    rebind(MCPFrontendContributionManager).to(QaapMCPFrontendContributionManager).inSingletonScope();
    // Same product model defaults as the frontend, so hosted per-user readers fall back to what Settings shows.
    bind(QaapAiModelDefaultsContribution).toSelf().inSingletonScope();
    bind(PreferenceContribution).toService(QaapAiModelDefaultsContribution);
});
