// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Argv, Arguments } from '@theia/core/shared/yargs';
import { CliContribution } from '@theia/core/lib/node/cli';
import { PluginMgmtCliContribution } from '@theia/plugin-ext/lib/main/node/plugin-mgmt-cli-contribution';
import { QaapPluginDeploymentGate } from './qaap-plugin-deployment-gate';

/** The `list-plugins` CLI command reads the deployed plugins, so it requests the deployment no client would. */
@injectable()
export class QaapPluginDeploymentCliContribution implements CliContribution {

    static readonly DEPLOYING_COMMANDS: readonly string[] = [PluginMgmtCliContribution.LIST_PLUGINS, 'list-extensions'];

    @inject(QaapPluginDeploymentGate)
    protected readonly deploymentGate: QaapPluginDeploymentGate;

    configure(_conf: Argv): void {
        // The command itself is declared by PluginMgmtCliContribution.
    }

    setArguments(args: Arguments): void {
        const commands = (args._ ?? []).map(String);
        if (commands.some(command => QaapPluginDeploymentCliContribution.DEPLOYING_COMMANDS.includes(command))) {
            this.deploymentGate.request();
        }
    }
}
