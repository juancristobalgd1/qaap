// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_TOOL_GATE_TOKEN_MAX_AGE_MS, QaapToolGateTokenService } from './qaap-tool-gate-token-service';

class ClockedTokenService extends QaapToolGateTokenService {
    time = 1_000;
    protected override now(): number {
        return this.time;
    }
    storedKeys(): string[] {
        return [...this.grants.keys()];
    }
}

describe('QaapToolGateTokenService', () => {

    it('resolves a live token to the task, owner and workspace it was issued for', () => {
        const service = new ClockedTokenService();
        const token = service.issue('task-1', 'alice', '/work/alice/repo');
        expect(token).to.match(/^[0-9a-f]{64}$/);
        expect(service.resolve(token)).to.deep.equal({ taskId: 'task-1', owner: 'alice', workspace: '/work/alice/repo' });
    });

    it('never resolves unknown, empty or undefined tokens', () => {
        const service = new ClockedTokenService();
        service.issue('task-1', 'alice', '/w');
        expect(service.resolve(undefined)).to.equal(undefined);
        expect(service.resolve('')).to.equal(undefined);
        expect(service.resolve('deadbeef')).to.equal(undefined);
    });

    it('stops resolving once the task is revoked, and revoke is idempotent', () => {
        const service = new ClockedTokenService();
        const token = service.issue('task-1', 'alice', '/w');
        service.revoke('task-1');
        service.revoke('task-1');
        expect(service.resolve(token)).to.equal(undefined);
    });

    it('expires a token after the max age', () => {
        const service = new ClockedTokenService();
        const token = service.issue('task-1', 'alice', '/w');
        service.time += QAAP_TOOL_GATE_TOKEN_MAX_AGE_MS - 1;
        expect(service.resolve(token)).to.not.equal(undefined);
        service.time += 1;
        expect(service.resolve(token)).to.equal(undefined);
    });

    it('issues one token per task: re-issuing replaces the old token', () => {
        const service = new ClockedTokenService();
        const first = service.issue('task-1', 'alice', '/w');
        const second = service.issue('task-1', 'alice', '/w');
        expect(first).to.not.equal(second);
        expect(service.resolve(first)).to.equal(undefined);
        expect(service.resolve(second)).to.not.equal(undefined);
    });

    it('keeps tasks isolated from each other', () => {
        const service = new ClockedTokenService();
        const a = service.issue('task-a', 'alice', '/a');
        const b = service.issue('task-b', 'bob', '/b');
        service.revoke('task-a');
        expect(service.resolve(a)).to.equal(undefined);
        expect(service.resolve(b)?.owner).to.equal('bob');
    });

    it('holds only a hash of the token in memory', () => {
        const service = new ClockedTokenService();
        const token = service.issue('task-1', 'alice', '/w');
        expect(service.storedKeys()).to.not.include(token);
    });

    it('arms a task only with the one-time nonce issued for it', () => {
        const service = new ClockedTokenService();
        service.issue('task-1', 'alice', '/w');
        expect(service.isArmed('task-1')).to.equal(false);
        const nonce = service.issueArmNonce('task-1');
        expect(nonce).to.match(/^[0-9a-f]{32}$/);
        expect(service.arm('task-1', undefined)).to.equal(false);
        expect(service.arm('task-1', 'wrong')).to.equal(false);
        expect(service.isArmed('task-1')).to.equal(false);
        expect(service.arm('task-1', nonce)).to.equal(true);
        expect(service.isArmed('task-1')).to.equal(true);
    });

    it('accepts a nonce once: a reused nonce does not arm again', () => {
        const service = new ClockedTokenService();
        service.issue('task-1', 'alice', '/w');
        const nonce = service.issueArmNonce('task-1');
        expect(service.arm('task-1', nonce)).to.equal(true);
        service.revoke('task-1');
        service.issue('task-1', 'alice', '/w');
        expect(service.arm('task-1', nonce)).to.equal(false);
        expect(service.isArmed('task-1')).to.equal(false);
    });

    it('issues no nonce without a live token, and never arms an unknown task', () => {
        const service = new ClockedTokenService();
        expect(service.issueArmNonce('task-1')).to.equal(undefined);
        expect(service.arm('task-1', 'anything')).to.equal(false);
        expect(service.isArmed('task-1')).to.equal(false);
    });

    it('a revoke clears the armed state and the pending nonce', () => {
        const service = new ClockedTokenService();
        service.issue('task-1', 'alice', '/w');
        const nonce = service.issueArmNonce('task-1');
        service.revoke('task-1');
        expect(service.arm('task-1', nonce)).to.equal(false);
        expect(service.isArmed('task-1')).to.equal(false);
    });

    it('re-issuing the token drops the armed state and the old nonce', () => {
        const service = new ClockedTokenService();
        service.issue('task-1', 'alice', '/w');
        const nonce = service.issueArmNonce('task-1');
        expect(service.arm('task-1', nonce)).to.equal(true);
        service.issue('task-1', 'alice', '/w');
        expect(service.isArmed('task-1')).to.equal(false);
        expect(service.arm('task-1', nonce)).to.equal(false);
    });
});
