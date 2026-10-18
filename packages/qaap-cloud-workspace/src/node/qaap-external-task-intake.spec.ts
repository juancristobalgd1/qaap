// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapExternalTaskIntakeRequest, QaapExternalTaskTriggerEvent } from '../common/qaap-external-task';
import {
    isExternalTaskRepositoryAllowed,
    isQaapExternalTasksGithubEnabled,
    QaapExternalTaskIntake,
} from './qaap-external-task-intake';

function event(overrides: Partial<QaapExternalTaskTriggerEvent> = {}): QaapExternalTaskTriggerEvent {
    return {
        source: 'github',
        trigger: 'label',
        deliveryId: 'd1',
        owner: 'acme',
        repo: 'demo',
        repositoryId: 99,
        issueNumber: 7,
        issueUrl: 'https://github.com/acme/demo/issues/7',
        issueTitle: 'Fix it',
        issueBody: 'body',
        issueAuthor: 'Alice',
        requester: 'alice',
        ...overrides,
    };
}

describe('QaapExternalTaskIntake', () => {
    const savedEnv: Record<string, string | undefined> = {};
    const envKeys = ['QAAP_EXTERNAL_TASKS_REPO_ALLOWLIST', 'QAAP_EXTERNAL_TASKS_MAX_PER_HOUR', 'QAAP_EXTERNAL_TASKS_MAX_PER_REPO_HOUR'];
    let verifyCalls: number;
    let verifyResult: any;
    let launched: QaapExternalTaskIntakeRequest[];
    let intake: QaapExternalTaskIntake;
    let originalInfo: typeof console.info;

    beforeEach(() => {
        for (const key of envKeys) {
            savedEnv[key] = process.env[key];
            delete process.env[key];
        }
        originalInfo = console.info;
        console.info = () => undefined;
        verifyCalls = 0;
        verifyResult = { ok: true };
        launched = [];
        intake = new QaapExternalTaskIntake();
        const fields = intake as any;
        fields.sessions = { listSessions: () => [{ accessToken: 'tok', user: { provider: 'github', login: 'Alice' } }] };
        fields.github = { verify: async () => { verifyCalls++; return verifyResult; } };
        fields.launcher = { launch: async (request: QaapExternalTaskIntakeRequest) => { launched.push(request); return { status: 'started', conversationId: 'c1' }; } };
        fields.pullRequests = { isTestMode: () => false, resolveOwnerToken: () => undefined };
        fields.docker = undefined;
    });

    afterEach(() => {
        console.info = originalInfo;
        for (const key of envKeys) {
            if (savedEnv[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = savedEnv[key];
            }
        }
    });

    it('ignores an unknown requester without verifying or launching', async () => {
        await intake.accept(event({ requester: 'mallory' }));
        expect(verifyCalls).to.equal(0);
        expect(launched).to.have.length(0);
    });

    it('ignores a duplicate delivery', async () => {
        await intake.accept(event());
        const second = await intake.accept(event());
        expect(second).to.equal('duplicate');
        expect(launched).to.have.length(1);
    });

    it('honours the repository allowlist', async () => {
        process.env.QAAP_EXTERNAL_TASKS_REPO_ALLOWLIST = 'other/*';
        await intake.accept(event());
        expect(verifyCalls).to.equal(0);
        expect(launched).to.have.length(0);
    });

    it('rate limits per requester', async () => {
        process.env.QAAP_EXTERNAL_TASKS_MAX_PER_HOUR = '2';
        await intake.accept(event({ deliveryId: 'a' }));
        await intake.accept(event({ deliveryId: 'b' }));
        await intake.accept(event({ deliveryId: 'c' }));
        expect(launched).to.have.length(2);
        expect(verifyCalls).to.equal(2);
    });

    it('launches with the requester login from the session when verified', async () => {
        const outcome = await intake.accept(event());
        expect(outcome).to.contain('dispatched');
        expect(launched).to.have.length(1);
        expect(launched[0].kind).to.equal('launch');
        expect(launched[0].requester).to.equal('Alice');
    });

    it('tells the requester about an actionable refusal', async () => {
        verifyResult = { ok: false, reason: 'untrusted-author' };
        await intake.accept(event());
        expect(launched).to.have.length(1);
        expect(launched[0].kind).to.equal('refused');
        if (launched[0].kind === 'refused') {
            expect(launched[0].reason).to.equal('untrusted-author');
        }
    });

    it('stays silent when GitHub did not confirm the request', async () => {
        verifyResult = { ok: false, reason: 'not-confirmed' };
        await intake.accept(event());
        expect(launched).to.have.length(0);
    });

    describe('helpers', () => {
        it('isQaapExternalTasksGithubEnabled reads QAAP_EXTERNAL_TASKS_GITHUB', () => {
            expect(isQaapExternalTasksGithubEnabled({})).to.equal(false);
            expect(isQaapExternalTasksGithubEnabled({ QAAP_EXTERNAL_TASKS_GITHUB: '1' })).to.equal(true);
            expect(isQaapExternalTasksGithubEnabled({ QAAP_EXTERNAL_TASKS_GITHUB: 'TRUE' })).to.equal(true);
            expect(isQaapExternalTasksGithubEnabled({ QAAP_EXTERNAL_TASKS_GITHUB: '0' })).to.equal(false);
        });

        it('isExternalTaskRepositoryAllowed matches exact and owner wildcard entries', () => {
            expect(isExternalTaskRepositoryAllowed('acme', 'demo', {})).to.equal(true);
            const env = { QAAP_EXTERNAL_TASKS_REPO_ALLOWLIST: 'Acme/Demo, other/*' };
            expect(isExternalTaskRepositoryAllowed('acme', 'demo', env)).to.equal(true);
            expect(isExternalTaskRepositoryAllowed('acme', 'nope', env)).to.equal(false);
            expect(isExternalTaskRepositoryAllowed('Other', 'anything', env)).to.equal(true);
            expect(isExternalTaskRepositoryAllowed('third', 'x', env)).to.equal(false);
        });
    });
});
