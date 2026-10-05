// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { PluginLocalizationServer } from '@theia/plugin-ext/lib/main/node/plugin-localization-server';
import { QaapPluginDeploymentGate } from './qaap-plugin-deployment-gate';

/**
 * Upstream answers every localization request only after the plugins are deployed (a plugin may be
 * a language pack). With deployment held by {@link QaapPluginDeploymentGate}, that would hang the
 * frontend i18n preload of a phone or Work Hub page with a non-English locale. Wait for the
 * deployment only once it was requested; Theia's own translations do not depend on it.
 */
@injectable()
export class QaapPluginLocalizationServer extends PluginLocalizationServer {

    @inject(QaapPluginDeploymentGate)
    protected readonly deploymentGate: QaapPluginDeploymentGate;

    override waitForInitialization(): Promise<void> {
        return this.deploymentGate.requested ? super.waitForInitialization() : this.initialized.promise;
    }
}
