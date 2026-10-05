// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { PluginDeployerContribution } from '@theia/plugin-ext/lib/main/node/plugin-deployer-contribution';
import { QaapPluginDeploymentGate } from './qaap-plugin-deployment-gate';

/** Starts the upstream plugin deployment on the first {@link QaapPluginDeploymentGate.request} instead of at backend initialization. */
@injectable()
export class QaapLazyPluginDeployerContribution extends PluginDeployerContribution {

    @inject(QaapPluginDeploymentGate)
    protected readonly deploymentGate: QaapPluginDeploymentGate;

    override initialize(): Promise<void> {
        // Same as upstream `initialize()`, but the gate learns when the deployment settles.
        this.deploymentGate.whenRequested
            .then(() => this.deploymentGate.trackInitialDeployment(this.pluginDeployer.start()))
            .catch(error => this.logger.error('Initializing plugin deployer failed.', error));
        return Promise.resolve();
    }
}
