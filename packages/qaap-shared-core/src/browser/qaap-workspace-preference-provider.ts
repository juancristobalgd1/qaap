// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { PreferenceProvider, PreferenceScope } from '@theia/core/lib/common/preferences';
import { injectable, interfaces, postConstruct } from '@theia/core/shared/inversify';
import { WorkspacePreferenceProvider } from '@theia/preferences/lib/browser/workspace-preference-provider';

/**
 * Follows a workspace opened after startup. Upstream builds the delegate once, when the workspace
 * service is ready, because opening a workspace reloads the page; `QaapWorkspaceService.openWithoutReload`
 * does not, and without this the project's settings would stay out of the Workspace scope until F5.
 */
@injectable()
export class QaapWorkspacePreferenceProvider extends WorkspacePreferenceProvider {

    @postConstruct()
    protected override init(): void {
        super.init();
        this.disposables.push(this.workspaceService.onWorkspaceChanged(() => this.ensureDelegateUpToDate()));
    }
}

/**
 * Replaces the Workspace-scope preference provider on activation. Upstream binds it as a named
 * `PreferenceProvider` (`whenTargetNamed(PreferenceScope.Workspace)`), which cannot be rebound in isolation.
 */
export function bindQaapWorkspacePreferenceProvider(bind: interfaces.Bind, onActivation: interfaces.Container['onActivation']): void {
    bind(QaapWorkspacePreferenceProvider).toSelf().inSingletonScope();
    onActivation<PreferenceProvider>(PreferenceProvider, (context, provider) => {
        const scope = context.currentRequest.target.getNamedTag()?.value;
        return scope === PreferenceScope.Workspace && !(provider instanceof QaapWorkspacePreferenceProvider)
            ? context.container.get(QaapWorkspacePreferenceProvider)
            : provider;
    });
}
