// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Delegation steps 3 and 4: follow-up turns (wake-up), durability across a restart (a new service over the
 * same store), cascade cancel, parent retirement and worktree collection, and the parent → children index.
 */

import { expect } from 'chai';
import { QAAP_AGENT_DELEGATION_MAX_FOLLOW_UPS, QAAP_AGENT_DELEGATION_UNTRUSTED_OPEN } from '../common/qaap-agent-delegation-protocol';
import { QaapAgentDelegationService, type QaapDelegationCallerContext } from './qaap-agent-delegation-service';
import { FakeStore, parentConversation } from './test/qaap-agent-delegation-fake-store';

const CTX: QaapDelegationCallerContext = { parentConversationId: 'parent', ownerLogin: 'alice', parentTurnId: 'turn-1' };

interface WorktreeCalls {
    readonly removed: string[];
    readonly keptBranch: string[];
}

/** A service over `store` (a "process" of the backend); several over one store simulate restarts. */
function startService(store: FakeStore, calls: WorktreeCalls = { removed: [], keptBranch: [] }): QaapAgentDelegationService {
    const service = new QaapAgentDelegationService();
    let created = 0;
    Object.assign(service, {
        store,
        wakeDelayMs: 5,
        worktrees: {
            create: async () => {
                created++;
                return { worktreePath: `/wt/${Date.now()}-${created}`, branch: `qaap/worktree/t${created}` };
            },
            removeForDeletedConversation: async (input: { worktreePath: string }) => {
                calls.removed.push(input.worktreePath);
                return true;
            },
            apply: async (input: { worktreePath: string; action: string }) => {
                calls.keptBranch.push(`${input.action}:${input.worktreePath}`);
                return { ok: true };
            },
        },
    });
    (service as unknown as { init(): void }).init();
    return service;
}

const settleTicks = (ms = 40): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
const followUps = (store: FakeStore): { id: string; content: string }[] => store.posted.filter(post => post.id === 'parent');

describe('QaapAgentDelegationService lifecycle', function (): void {
    this.timeout(15_000);
    let store: FakeStore;
    let savedFlag: string | undefined;

    beforeEach(() => {
        savedFlag = process.env.QAAP_AGENT_DELEGATION;
        process.env.QAAP_AGENT_DELEGATION = '1';
        store = new FakeStore();
        // The parent's turn is over (idle) unless a spec makes it busy.
        store.conversations.set('parent', parentConversation({ status: 'idle', autoApprove: undefined, approvalPolicyId: undefined }));
    });
    afterEach(() => {
        if (savedFlag === undefined) {
            delete process.env.QAAP_AGENT_DELEGATION;
        } else {
            process.env.QAAP_AGENT_DELEGATION = savedFlag;
        }
    });

    describe('wake-up', () => {

        it('posts one follow-up turn with the untrusted report when an idle parent\'s child ends, charged to the root turn', async () => {
            const service = startService(store);
            const childId = (await service.delegate(CTX, { prompt: 'count TODOs' })).child.childId;
            store.settle(childId, 'completed', 'Found 7 TODOs.');
            await settleTicks();
            const posts = followUps(store);
            expect(posts).to.have.length(1);
            expect(posts[0].content).to.contain(QAAP_AGENT_DELEGATION_UNTRUSTED_OPEN).and.to.contain('Found 7 TODOs.').and.to.contain('untrusted');
            const followUp = store.conversations.get('parent')!.messages.at(-1)!;
            expect(followUp.autoContinueRootMessageId).to.equal('turn-1');
            expect(store.conversations.get(childId)!.delegation?.deliveredAt).to.be.a('number');
            expect(store.conversations.get('parent')!.delegationParent?.followUps).to.deep.equal({ 'turn-1': 1 });
            // Nothing new to deliver: no second follow-up.
            store.settleParent('parent', 'success');
            await settleTicks();
            expect(followUps(store)).to.have.length(1);
        });

        it('gives the reports (and the follow-up they used) back when posting the follow-up fails, so the next evaluation delivers them', async () => {
            const service = startService(store);
            Object.assign(service, { wakeRetryBackoffMs: [60_000, 60_000, 60_000] });
            const childId = (await service.delegate(CTX, { prompt: 'count TODOs' })).child.childId;
            const realPost = store.postUserMessage.bind(store);
            let failing = true;
            store.postUserMessage = ((...args: Parameters<FakeStore['postUserMessage']>) => {
                if (args[0] === 'parent' && failing) {
                    throw new Error('store unavailable');
                }
                return realPost(...args);
            }) as FakeStore['postUserMessage'];
            const originalWarn = console.warn;
            console.warn = (): void => undefined;
            try {
                store.settle(childId, 'completed', 'Found 7 TODOs.');
                await settleTicks();
            } finally {
                console.warn = originalWarn;
            }
            expect(followUps(store)).to.have.length(0);
            expect(store.conversations.get(childId)!.delegation?.deliveredAt, 'report not lost').to.equal(undefined);
            expect(store.conversations.get('parent')!.delegationParent?.followUps ?? {}).to.deep.equal({});
            failing = false;
            // Skip the backoff window: this spec drives the next evaluation by hand.
            (service as unknown as { wakeFailures: Map<string, unknown> }).wakeFailures.clear();
            expect((service as unknown as { evaluateWake(id: string): boolean }).evaluateWake('parent')).to.equal(true);
            expect(followUps(store)).to.have.length(1);
            expect(followUps(store)[0].content).to.contain('Found 7 TODOs.');
            expect(store.conversations.get(childId)!.delegation?.deliveredAt).to.be.a('number');
            expect(store.conversations.get('parent')!.delegationParent?.followUps).to.deep.equal({ 'turn-1': 1 });
        });

        it('retries a failing follow-up post with backoff, at most 3 times, then leaves the reports undelivered', async () => {
            const service = startService(store);
            Object.assign(service, { wakeRetryBackoffMs: [15, 15, 15] });
            const childId = (await service.delegate(CTX, { prompt: 'count TODOs' })).child.childId;
            const realPost = store.postUserMessage.bind(store);
            let attempts = 0;
            store.postUserMessage = ((...args: Parameters<FakeStore['postUserMessage']>) => {
                if (args[0] === 'parent') {
                    attempts++;
                    throw new Error('store unavailable');
                }
                return realPost(...args);
            }) as FakeStore['postUserMessage'];
            const originalWarn = console.warn;
            console.warn = (): void => undefined;
            try {
                store.settle(childId, 'completed', 'Found 7 TODOs.');
                await settleTicks(400);
                expect(attempts, '1 attempt + 3 retries').to.equal(4);
                // Further store activity does not restart the loop.
                store.settle(childId, 'completed', 'again');
                (service as unknown as { onChildChanged(id: string): void }).onChildChanged('parent');
                await settleTicks(200);
            } finally {
                console.warn = originalWarn;
            }
            expect(attempts).to.equal(4);
            expect(store.conversations.get(childId)!.delegation?.deliveredAt, 'children stay undelivered').to.equal(undefined);
            expect(store.conversations.get('parent')!.delegationParent?.followUps ?? {}).to.deep.equal({});
        });

        it('waits for the backoff before retrying a failed follow-up', async () => {
            const service = startService(store);
            Object.assign(service, { wakeRetryBackoffMs: [10_000, 10_000, 10_000] });
            const childId = (await service.delegate(CTX, { prompt: 'x' })).child.childId;
            const realPost = store.postUserMessage.bind(store);
            let attempts = 0;
            store.postUserMessage = ((...args: Parameters<FakeStore['postUserMessage']>) => {
                if (args[0] === 'parent') {
                    attempts++;
                    throw new Error('store unavailable');
                }
                return realPost(...args);
            }) as FakeStore['postUserMessage'];
            const originalWarn = console.warn;
            console.warn = (): void => undefined;
            try {
                store.settle(childId, 'completed', 'done');
                await settleTicks();
                (service as unknown as { onChildChanged(id: string): void }).onChildChanged('parent');
                await settleTicks();
            } finally {
                console.warn = originalWarn;
                for (const timer of (service as unknown as { wakeTimers: Map<string, ReturnType<typeof setTimeout>> }).wakeTimers.values()) {
                    clearTimeout(timer);
                }
            }
            expect(attempts, 'no retry inside the backoff window').to.equal(1);
        });

        it('sends nothing while the parent is blocked in qaaq_task_wait: the wait delivers the report', async () => {
            const service = startService(store);
            const childId = (await service.delegate(CTX, { prompt: 'x' })).child.childId;
            const waiting = service.wait(CTX, { childIds: [childId], timeoutSec: 5 });
            store.settle(childId, 'completed', 'done');
            const response = await waiting;
            expect(response.finished.map(report => report.childId)).to.deep.equal([childId]);
            await settleTicks();
            expect(followUps(store)).to.have.length(0);
            expect(store.conversations.get(childId)!.delegation?.deliveredAt).to.be.a('number');
        });

        it('defers while the parent is busy with another turn and delivers when that turn settles', async () => {
            const service = startService(store);
            const childId = (await service.delegate(CTX, { prompt: 'x' })).child.childId;
            store.activeTasks.set('parent', ['task-busy']);
            store.settle(childId, 'completed', 'late report');
            await settleTicks();
            expect(followUps(store)).to.have.length(0);
            store.activeTasks.delete('parent');
            store.settleParent('parent', 'success');
            await settleTicks();
            expect(followUps(store)).to.have.length(1);
            expect(followUps(store)[0].content).to.contain('late report');
        });

        it(`stops after ${QAAP_AGENT_DELEGATION_MAX_FOLLOW_UPS} follow-ups for one human turn`, async () => {
            const service = startService(store);
            for (let i = 0; i < QAAP_AGENT_DELEGATION_MAX_FOLLOW_UPS + 2; i++) {
                const childId = (await service.delegate(CTX, { prompt: `part ${i}` })).child.childId;
                store.settle(childId, 'completed', `report ${i}`);
                await settleTicks();
                // The follow-up turn ran and ended; the parent is idle again.
                store.conversations.set('parent', { ...store.conversations.get('parent')!, status: 'idle' });
            }
            expect(followUps(store)).to.have.length(QAAP_AGENT_DELEGATION_MAX_FOLLOW_UPS);
        });
    });

    describe('cascade cancel', () => {

        it('a cancelled parent turn stops running children, empties the queue, and never wakes the parent', async () => {
            const service = startService(store);
            store.conversations.set('parent', { ...store.conversations.get('parent')!, status: 'streaming' });
            const ids: string[] = [];
            for (let i = 0; i < 4; i++) {
                ids.push((await service.delegate(CTX, { prompt: `part ${i}` })).child.childId);
            }
            expect(store.conversations.get(ids[3])!.delegation?.pendingPrompt).to.be.a('string');
            store.settleParent('parent', 'cancelled');
            expect(store.cancelled.sort()).to.deep.equal(ids.slice(0, 3).sort());
            const queued = store.conversations.get(ids[3])!;
            expect(queued.delegation?.pendingPrompt).to.equal(undefined);
            expect(queued.messages, 'the queued child never started').to.have.length(0);
            expect(service.status(CTX, {}).children.every(child => child.state === 'cancelled')).to.equal(true);
            store.settle(ids[0], 'cancelled', 'stopped');
            await settleTicks();
            expect(followUps(store)).to.have.length(0);
            expect(store.conversations.get('parent')!.delegationParent?.suppressedRootTurnId).to.equal('turn-1');
        });
    });

    describe('cascade cancel of an idle parent', () => {

        it('Stop on a parent with no live turn still stops its running and queued children and keeps their reports from waking it', async () => {
            const service = startService(store);
            const ids: string[] = [];
            for (let i = 0; i < 4; i++) {
                ids.push((await service.delegate(CTX, { prompt: `part ${i}` })).child.childId);
            }
            expect(store.conversations.get('parent')!.status).to.equal('idle');
            store.cancelled.length = 0;
            store.userStop('parent');
            expect(store.cancelled.sort()).to.deep.equal(ids.slice(0, 3).sort());
            expect(store.conversations.get(ids[3])!.delegation?.pendingPrompt, 'the queued child never starts').to.equal(undefined);
            expect(service.status(CTX, {}).children.every(child => child.state === 'cancelled')).to.equal(true);
            expect(store.conversations.get('parent')!.delegationParent?.suppressedRootTurnId).to.equal('turn-1');
            store.settle(ids[0], 'cancelled', 'stopped');
            await settleTicks();
            expect(followUps(store)).to.have.length(0);
        });

        it('Stop while a delegate call is still creating its child stops that child at once and answers cancelled', async () => {
            const service = startService(store);
            let release: () => void = () => undefined;
            const gate = new Promise<void>(resolve => { release = resolve; });
            const realCreate = (service as unknown as { worktrees: { create(): Promise<{ worktreePath: string; branch: string }> } }).worktrees.create;
            Object.assign((service as unknown as { worktrees: object }).worktrees, {
                create: async () => {
                    await gate;
                    return realCreate();
                },
            });
            const pending = service.delegate(CTX, { prompt: 'slow part' });
            await settleTicks(10);
            // The user presses Stop on the parent while the worktree is still being made: no child exists yet.
            store.userStop('parent');
            release();
            const { child } = await pending;
            expect(child.state).to.equal('cancelled');
            expect(store.conversations.get(child.childId)!.delegation?.cancelRequested).to.equal(true);
            expect(store.cancelled).to.include(child.childId);
            await settleTicks();
            expect(followUps(store), 'its report never wakes the parent').to.have.length(0);
        });

        it('ignores a Stop on a conversation with no unfinished children, and on a child', async () => {
            const service = startService(store);
            store.userStop('parent');
            const childId = (await service.delegate(CTX, { prompt: 'part' })).child.childId;
            store.settle(childId, 'completed', 'done');
            store.cancelled.length = 0;
            store.userStop('parent');
            store.userStop(childId);
            expect(store.cancelled).to.deep.equal([]);
            expect(store.conversations.get('parent')!.delegationParent?.suppressedRootTurnId).to.equal(undefined);
        });
    });

    describe('durability across a restart', () => {

        it('reconciles a queued and a lost child, wakes the parent once, and never re-delivers after another restart', async () => {
            store.conversations.set('parent', { ...store.conversations.get('parent')!, status: 'streaming' });
            const first = startService(store);
            const ids: string[] = [];
            for (let i = 0; i < 4; i++) {
                ids.push((await first.delegate(CTX, { prompt: `part ${i}` })).child.childId);
            }
            // A child the old process created but neither started nor queued (crash mid-creation).
            const lost = store.create({ cwd: '/wt/lost', parentConversationId: 'parent', delegation: { isolation: 'worktree', depth: 1, rootTurnId: 'turn-1' } }, 'alice');
            // "Restart": the parent's interrupted turn is over; a fresh service starts over the same store.
            store.conversations.set('parent', { ...store.conversations.get('parent')!, status: 'idle' });
            const second = startService(store);
            await settleTicks();
            const lostView = second.status(CTX, { childId: lost.id }).children[0];
            expect(lostView.state).to.equal('failed');
            expect(store.conversations.get(lost.id)!.delegation?.startFailure).to.match(/lost before it started/);
            // The queued child keeps its place and starts when a running one ends.
            expect(second.status(CTX, { childId: ids[3] }).children[0].state).to.equal('queued');
            // The lost child is a finished (failed) task the parent has not heard of: it gets told at once.
            expect(followUps(store)).to.have.length(1);
            expect(followUps(store)[0].content).to.contain(lost.id).and.to.contain('lost before it started');
            store.settle(ids[0], 'completed', 'report zero');
            await settleTicks();
            expect(store.conversations.get(ids[3])!.messages, 'queued child started after the restart').to.have.length(1);
            // The parent was busy with that follow-up; when it settles the next report arrives, once.
            store.settleParent('parent', 'success');
            await settleTicks();
            const afterSecond = followUps(store).length;
            expect(afterSecond).to.equal(2);
            expect(followUps(store)[1].content).to.contain('report zero').and.to.not.contain('lost before it started');
            // Another restart: delivered marks are durable, so nothing is sent again.
            store.conversations.set('parent', { ...store.conversations.get('parent')!, status: 'idle' });
            startService(store);
            await settleTicks();
            expect(followUps(store)).to.have.length(afterSecond);
        });
    });

    describe('retirement and worktree collection', () => {

        it('collects an applied child\'s worktree once the parent\'s turn settles', async () => {
            const calls: WorktreeCalls = { removed: [], keptBranch: [] };
            const service = startService(store, calls);
            const childId = (await service.delegate(CTX, { prompt: 'x' })).child.childId;
            store.settle(childId, 'completed', 'done');
            const child = store.conversations.get(childId)!;
            store.setDelegationState(childId, { delegation: { ...child.delegation!, appliedAt: 1 } });
            store.settleParent('parent', 'success');
            await settleTicks();
            expect(calls.removed).to.deep.equal([child.cwd]);
            expect(store.conversations.get(childId)!.delegation?.worktreeCollectedAt).to.be.a('number');
        });

        it('archiving the parent stops running children and commits finished ones to their branch before removing the worktree', async () => {
            const calls: WorktreeCalls = { removed: [], keptBranch: [] };
            const service = startService(store, calls);
            const done = (await service.delegate(CTX, { prompt: 'a' })).child.childId;
            const running = (await service.delegate(CTX, { prompt: 'b' })).child.childId;
            store.settle(done, 'completed', 'ok');
            store.archive('parent');
            await settleTicks();
            expect(store.cancelled).to.deep.equal([running]);
            expect(calls.keptBranch).to.deep.equal([`keep-branch:${store.conversations.get(done)!.cwd}`]);
            store.settle(running, 'cancelled', 'stopped');
            await settleTicks();
            expect(calls.keptBranch).to.have.length(2);
            expect(followUps(store)).to.have.length(0);
        });

        it('deleting the parent stops its children', async () => {
            const service = startService(store);
            const running = (await service.delegate(CTX, { prompt: 'b' })).child.childId;
            store.delete('parent');
            await settleTicks();
            expect(store.cancelled).to.deep.equal([running]);
        });
    });

    it('builds the parent → children index once instead of listing every conversation per call', async () => {
        const service = startService(store);
        let listings = 0;
        const original = store.listAllGroupedByCwd.bind(store);
        store.listAllGroupedByCwd = () => {
            listings++;
            return original();
        };
        for (let i = 0; i < 3; i++) {
            await service.delegate(CTX, { prompt: `p${i}` });
        }
        service.status(CTX, {});
        expect(listings).to.be.at.most(1);
        expect(service.status(CTX, {}).children).to.have.length(3);
    });
});
