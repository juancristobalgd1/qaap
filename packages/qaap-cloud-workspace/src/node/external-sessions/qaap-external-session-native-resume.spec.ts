// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapUsageRoots } from '../usage/qaap-usage-roots';
import { QaapExternalNativeResume } from './qaap-external-session-native-resume';

describe('QaapExternalNativeResume.plan', () => {

    const SESSION = '3f1c2b9e-1111-4222-8333-944455556666';
    const CWD = '/work/app';
    let home: string;
    let roots: QaapUsageRoots;

    beforeEach(() => {
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-native-resume-'));
        roots = QaapUsageRoots.resolve({}, home);
    });

    afterEach(() => {
        fs.rmSync(home, { recursive: true, force: true });
    });

    const writeClaudeSession = (): void => {
        // Claude Code's slug of the resolved cwd (`D:\work\app` → `D--work-app` on Windows).
        const dir = path.join(roots.claudeProjects, path.resolve(CWD).replace(/[^A-Za-z0-9]/g, '-'));
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${SESSION}.jsonl`), '{}\n');
    };
    const writeCodexRollout = (): string => {
        const file = path.join(roots.codexSessions, '2026', '11', '09', `rollout-2026-11-09T10-00-00-${SESSION}.jsonl`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '{}\n');
        return file;
    };
    const base = { sessionId: SESSION, cwd: CWD, codexUsesOverlay: false, codexOverlayWritable: true };

    it('resumes Claude only when the agent reads the same config dir that holds the session', () => {
        writeClaudeSession();
        expect(QaapExternalNativeResume.plan({ ...base, agentId: 'claude', agentEnv: { HOME: home }, roots })).to.deep.equal({ kind: 'claude', sessionId: SESSION });
        expect(QaapExternalNativeResume.plan({ ...base, agentId: 'claude', agentEnv: { HOME: path.join(home, 'tenant') }, roots })).to.equal(undefined);
    });

    it('does not resume a Claude session whose log is gone', () => {
        expect(QaapExternalNativeResume.plan({ ...base, agentId: 'claude', agentEnv: { HOME: home }, roots })).to.equal(undefined);
    });

    it('resumes Codex through a writable gate overlay, from wherever the rollout was imported', () => {
        const rollout = writeCodexRollout();
        const plan = QaapExternalNativeResume.plan({ ...base, agentId: 'codex', agentEnv: { HOME: '/elsewhere' }, codexUsesOverlay: true, roots });
        expect(plan).to.deep.equal({ kind: 'codex', sessionId: SESSION, rollout, codexSessionsRoot: roots.codexSessions });
        expect(QaapExternalNativeResume.plan({ ...base, agentId: 'codex', agentEnv: {}, codexUsesOverlay: true, codexOverlayWritable: false, roots })).to.equal(undefined);
    });

    it('resumes Codex without an overlay only when the agent uses the same Codex home', () => {
        writeCodexRollout();
        expect(QaapExternalNativeResume.plan({ ...base, agentId: 'codex', agentEnv: { HOME: home }, roots })?.kind).to.equal('codex');
        expect(QaapExternalNativeResume.plan({ ...base, agentId: 'codex', agentEnv: { CODEX_HOME: '/other/.codex' }, roots })).to.equal(undefined);
    });

    it('never resumes other agents or unsafe ids', () => {
        expect(QaapExternalNativeResume.plan({ ...base, agentId: 'pi', agentEnv: { HOME: home }, roots })).to.equal(undefined);
        expect(QaapExternalNativeResume.plan({ ...base, sessionId: '../x', agentId: 'claude', agentEnv: { HOME: home }, roots })).to.equal(undefined);
    });
});
