// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveQaapHarnessLaunchEnvironment } from './qaap-harness-launch-environment';
import type { QaapHarnessEnvSecretStore } from './qaap-harness-env-secret-store';
import { QaapHarnessLaunchOverrideError } from './qaap-harness-launch-overrides';

const DESKTOP_ENV: NodeJS.ProcessEnv = { QAAP_DESKTOP: '1' };
const PATHS_OK = { checkBinary: () => undefined, checkHome: () => undefined };

function prefs(values: Record<string, unknown>): (key: string) => unknown {
    return key => values[key];
}

const PREFS = prefs({
    'ai-features.harness.settings': {
        codex: { binaryPath: '/opt/codex/bin/codex', homeDir: '/Users/me/.codex-base' },
        'codex#2': { label: 'Codex (work)', binaryPath: '/opt/codex-work/codex', homeDir: '/Users/me/.codex-work', envNames: ['OPENAI_ORG'] },
    },
    'ai-features.harness.instances': [{ id: 'codex#2', baseId: 'codex' }],
});

/** A secret store that only answers `resolve`; the values never leave the test. */
function secrets(values: Record<string, Record<string, string>>): QaapHarnessEnvSecretStore {
    return {
        resolve: async (harnessId: string, names: readonly string[]) => {
            const stored = values[harnessId] ?? {};
            const result: Record<string, string> = {};
            for (const name of names) {
                if (stored[name] !== undefined) {
                    result[name] = stored[name];
                }
            }
            return result;
        },
    } as unknown as QaapHarnessEnvSecretStore;
}

describe('qaap-harness-launch-environment', () => {

    it('gives an instance its own configuration folder, never the base folder', async () => {
        const launch = await resolveQaapHarnessLaunchEnvironment('codex#2', PREFS, undefined, { env: DESKTOP_ENV, ...PATHS_OK });
        expect(launch.plan.binaryPath).to.equal('/opt/codex-work/codex');
        const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
        launch.apply(env);
        expect(env.CODEX_HOME).to.equal('/Users/me/.codex-work');
    });

    it('keeps the base harness on its own folder and binary', async () => {
        const launch = await resolveQaapHarnessLaunchEnvironment('codex', PREFS, undefined, { env: DESKTOP_ENV, ...PATHS_OK });
        expect(launch.plan.binaryPath).to.equal('/opt/codex/bin/codex');
        const env: NodeJS.ProcessEnv = {};
        launch.apply(env);
        expect(env.CODEX_HOME).to.equal('/Users/me/.codex-base');
    });

    it('applies the instance variables from the secret store to its environment only', async () => {
        const launch = await resolveQaapHarnessLaunchEnvironment('codex#2', PREFS, secrets({ 'codex#2': { OPENAI_ORG: 'org-work' } }), {
            env: DESKTOP_ENV,
            ...PATHS_OK,
        });
        const env: NodeJS.ProcessEnv = {};
        launch.apply(env);
        expect(env.OPENAI_ORG).to.equal('org-work');
    });

    it('does not let the base harness variables leak into the instance', async () => {
        const launch = await resolveQaapHarnessLaunchEnvironment('codex#2', PREFS, secrets({ codex: { OPENAI_ORG: 'org-base' } }), {
            env: DESKTOP_ENV,
            ...PATHS_OK,
        });
        const env: NodeJS.ProcessEnv = {};
        launch.apply(env);
        expect(env.OPENAI_ORG).to.equal(undefined);
    });

    it('keeps a variable the runner already set to its own value', async () => {
        const launch = await resolveQaapHarnessLaunchEnvironment('codex#2', PREFS, secrets({ 'codex#2': { OPENAI_ORG: 'org-work' } }), {
            env: DESKTOP_ENV,
            backendEnv: {},
            ...PATHS_OK,
        });
        const env: NodeJS.ProcessEnv = { OPENAI_ORG: 'runner-value' };
        launch.apply(env);
        expect(env.OPENAI_ORG).to.equal('runner-value');
    });

    it('throws for an instance whose folder does not validate, instead of using the base folder', async () => {
        let error: unknown;
        try {
            await resolveQaapHarnessLaunchEnvironment('codex#2', PREFS, undefined, {
                env: DESKTOP_ENV,
                checkBinary: () => undefined,
                checkHome: () => 'missing',
            });
        } catch (caught) {
            error = caught;
        }
        expect(error).to.be.instanceOf(QaapHarnessLaunchOverrideError);
    });

    it('changes nothing outside the desktop app, even when folders are stored', async () => {
        const launch = await resolveQaapHarnessLaunchEnvironment('codex#2', PREFS, secrets({ 'codex#2': { OPENAI_ORG: 'org-work' } }), { env: {} });
        expect(launch.plan).to.deep.equal({});
        const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
        launch.apply(env);
        expect(env).to.deep.equal({ PATH: '/usr/bin' });
    });
});
