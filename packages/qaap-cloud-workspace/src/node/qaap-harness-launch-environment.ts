// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    applyQaapHarnessUserEnv,
    type QaapHarnessLaunchPlan,
    type QaapHarnessLaunchPlanOptions,
    resolveQaapHarnessLaunchPlan,
} from './qaap-harness-launch-overrides';
import type { QaapHarnessEnvSecretStore } from './qaap-harness-env-secret-store';

/**
 * How one harness key (a base such as `codex`, or an instance such as `codex#2`) is launched: its validated
 * binary/configuration-folder plan and the user's variables, read from the secret store. Built once per
 * spawn, probe or catalog run; the values only ever go into an environment object, never a command line.
 */
export interface QaapHarnessLaunchEnvironment {
    readonly plan: QaapHarnessLaunchPlan;
    /**
     * Writes the harness's environment into `env`: the user's variables first, then the configuration folder
     * variable (so the folder wins over a user variable of the same name). Outside the desktop app it changes nothing.
     */
    apply(env: NodeJS.ProcessEnv): void;
}

export interface QaapHarnessLaunchEnvironmentOptions extends QaapHarnessLaunchPlanOptions {
    /** The backend environment the user's variables are compared against (runner-set values win). */
    readonly backendEnv?: NodeJS.ProcessEnv;
}

/**
 * Resolves the launch environment of `harnessKey`. Throws {@link QaapHarnessLaunchOverrideError} when the
 * configured binary or folder does not validate: callers must treat that harness as unavailable and never
 * fall back to the default binary or account.
 */
export async function resolveQaapHarnessLaunchEnvironment(
    harnessKey: string,
    readPref: (key: string) => unknown,
    secrets: QaapHarnessEnvSecretStore | undefined,
    options: QaapHarnessLaunchEnvironmentOptions = {},
): Promise<QaapHarnessLaunchEnvironment> {
    const plan = resolveQaapHarnessLaunchPlan(harnessKey, readPref, options);
    const values = plan.envNames?.length && secrets ? await secrets.resolve(harnessKey, plan.envNames) : {};
    const backendEnv = options.backendEnv ?? process.env;
    return {
        plan,
        apply(env: NodeJS.ProcessEnv): void {
            applyQaapHarnessUserEnv(env, values, backendEnv);
            if (plan.homeEnvVar && plan.homeDir) {
                env[plan.homeEnvVar] = plan.homeDir;
            }
        },
    };
}
