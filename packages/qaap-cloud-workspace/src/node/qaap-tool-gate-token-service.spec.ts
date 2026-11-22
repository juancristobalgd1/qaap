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

describe('QaapToolGateTokenService scopes (agent delegation)', () => {

    it('issues a plain gate token by default: authorized for gate, refused for delegate', () => {
        const service = new ClockedTokenService();
        const token = service.issue('task-1', 'alice', '/w');
        expect(service.authorize(token, 'gate')).to.deep.equal({
            ok: true, grant: { taskId: 'task-1', owner: 'alice', workspace: '/w', scopes: ['gate'] },
        });
        expect(service.authorize(token, 'delegate')).to.deep.equal({ ok: false, reason: 'scope' });
        expect(service.hasScope('task-1', 'delegate')).to.equal(false);
    });

    it('grants a top-level task a SEPARATE delegation token holding only the delegate scope', () => {
        const service = new ClockedTokenService();
        const gate = service.issue('task-1', 'alice', '/w');
        const issued = service.issueDelegation('task-1', 'alice', '/w')!;
        const result = service.authorize(issued.token, 'delegate', { expectedOwner: 'alice' });
        expect(result.ok).to.equal(true);
        expect((result as unknown as { grant: { scopes: string[] } }).grant.scopes).to.deep.equal(['delegate']);
        expect(service.authorize(issued.token, 'gate')).to.deep.equal({ ok: false, reason: 'scope' });
        expect(service.authorize(gate, 'delegate')).to.deep.equal({ ok: false, reason: 'scope' });
        expect(service.hasScope('task-1', 'delegate')).to.equal(true);
    });

    it('never issues a delegation token to a child task (depth 1) or for an odd depth', () => {
        const service = new ClockedTokenService();
        expect(service.issueDelegation('child-1', 'alice', '/w', 1)).to.equal(undefined);
        for (const delegationDepth of [-1, 0.5, Number.NaN]) {
            expect(service.issueDelegation(`odd-${delegationDepth}`, 'alice', '/w', delegationDepth)).to.equal(undefined);
        }
    });

    it('never grants delegate to a one-shot grant', () => {
        const service = new ClockedTokenService();
        const { token } = service.issueOneShot('claude', 'alice', '/w');
        expect(service.authorize(token, 'delegate')).to.deep.equal({ ok: false, reason: 'scope' });
    });

    it('refuses a token issued for another tenant', () => {
        const service = new ClockedTokenService();
        const token = service.issueDelegation('task-1', 'alice', '/w')!.token;
        expect(service.authorize(token, 'delegate', { expectedOwner: 'bob' })).to.deep.equal({ ok: false, reason: 'owner' });
        expect(service.authorize(token, 'gate', { expectedOwner: 'bob' })).to.deep.equal({ ok: false, reason: 'owner' });
        expect(service.authorize(token, 'delegate', { expectedOwner: undefined })).to.deep.equal({ ok: false, reason: 'owner' });
        const anonymous = service.issueDelegation('task-2', undefined, '/w')!.token;
        expect(service.authorize(anonymous, 'delegate', { expectedOwner: 'alice' })).to.deep.equal({ ok: false, reason: 'owner' });
        expect(service.authorize(anonymous, 'delegate', { expectedOwner: undefined }).ok).to.equal(true);
        expect(service.authorize(token, 'delegate', { expectedOwner: ' Alice ' }).ok, 'logins compare case-insensitively').to.equal(true);
    });

    it('refuses unknown, revoked and expired tokens as invalid, and the delegate scope expires with the token', () => {
        const service = new ClockedTokenService();
        expect(service.authorize(undefined, 'delegate')).to.deep.equal({ ok: false, reason: 'invalid' });
        expect(service.authorize('deadbeef', 'gate')).to.deep.equal({ ok: false, reason: 'invalid' });
        const revoked = service.issueDelegation('task-r', 'alice', '/w')!.token;
        service.revoke('task-r');
        expect(service.authorize(revoked, 'delegate')).to.deep.equal({ ok: false, reason: 'invalid' });
        const token = service.issueDelegation('task-1', 'alice', '/w')!.token;
        service.time += QAAP_TOOL_GATE_TOKEN_MAX_AGE_MS - 1;
        expect(service.authorize(token, 'delegate').ok).to.equal(true);
        service.time += 1;
        expect(service.authorize(token, 'delegate')).to.deep.equal({ ok: false, reason: 'invalid' });
        expect(service.hasScope('task-1', 'delegate')).to.equal(false);
        expect(service.resolve(token)).to.equal(undefined);
    });

    it('re-issuing the gate token keeps the task\'s delegation token valid, and revoking the task drops both', () => {
        const service = new ClockedTokenService();
        const delegation = service.issueDelegation('task-1', 'alice', '/w')!.token;
        const first = service.issue('task-1', 'alice', '/w');
        const second = service.issue('task-1', 'alice', '/w');
        expect(service.authorize(first, 'gate')).to.deep.equal({ ok: false, reason: 'invalid' });
        expect(service.authorize(second, 'gate').ok).to.equal(true);
        expect(service.authorize(delegation, 'delegate').ok).to.equal(true);
        service.revoke('task-1');
        expect(service.authorize(delegation, 'delegate')).to.deep.equal({ ok: false, reason: 'invalid' });
    });
});
