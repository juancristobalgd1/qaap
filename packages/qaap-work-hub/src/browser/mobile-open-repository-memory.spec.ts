// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { MobileOpenRepositoryDialog } from './mobile-open-repository-dialog';
import type { MobileProjectsService } from '@theia/qaap-shared-core/lib/browser/mobile-projects-service';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import type { QaapGithubWorkspaceJobRequest } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

interface RecordedRequest {
    readonly url: string;
    readonly method: string;
    readonly body?: string;
}

interface FetchScript {
    billingPlanId: 'starter' | 'pro';
    /** Memory saved for the repository; `GET` answers with it and `POST` echoes the new value. */
    savedMemoryGb: number;
}

const REPO_FULL_NAME = 'octocat/Hello-World';

function planOf(planId: 'starter' | 'pro'): { options: number[]; defaultGb: number } {
    return planId === 'pro' ? { options: [2, 4], defaultGb: 2 } : { options: [2], defaultGb: 2 };
}

function project(): MobileProjectEntry {
    return {
        name: 'Hello-World',
        github: { owner: 'octocat', name: 'Hello-World', fullName: REPO_FULL_NAME, private: false },
    } as unknown as MobileProjectEntry;
}

async function settle(check: () => boolean): Promise<void> {
    for (let i = 0; i < 100 && !check(); i++) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
}

describe('MobileOpenRepositoryDialog workspace memory', () => {

    useSuiteJSDOM();

    const originalFetch = globalThis.fetch;
    let requests: RecordedRequest[];
    let script: FetchScript;

    function installFetch(): void {
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const url = String(input);
            const method = init?.method ?? 'GET';
            const body = typeof init?.body === 'string' ? init.body : undefined;
            requests.push({ url, method, body });
            const pathname = new URL(url, 'http://qaap.test').pathname;
            const plan = planOf(script.billingPlanId);
            let payload: object;
            if (pathname === '/qaap/api/billing/project-resources') {
                const parsed = body ? JSON.parse(body) as { memoryGb: number } : undefined;
                if (parsed) {
                    script.savedMemoryGb = parsed.memoryGb;
                }
                payload = { repo: REPO_FULL_NAME, memoryGb: script.savedMemoryGb, options: plan.options, plan: script.billingPlanId };
            } else {
                payload = {
                    account: { login: 'octocat', planId: script.billingPlanId, updatedAt: '2026-11-13T00:00:00.000Z' },
                    entitlements: {
                        planId: script.billingPlanId,
                        priceUsdMonthly: script.billingPlanId === 'pro' ? 12 : 4.99,
                        memoryOptionsGb: plan.options,
                        defaultMemoryGb: plan.defaultGb,
                        cpuLimit: 2,
                        storageGb: 10,
                        maxActiveRepos: 3,
                        maxConcurrentAgents: 2,
                        idlePauseMinutes: 30,
                    },
                    catalog: { plans: [] },
                };
            }
            return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }) as typeof fetch;
    }

    /** Dialog whose import start is recorded instead of run; the real start needs the import tracker. */
    function createDialog(): { dialog: MobileOpenRepositoryDialog; started: QaapGithubWorkspaceJobRequest[] } {
        const started: QaapGithubWorkspaceJobRequest[] = [];
        const service = {
            getConnectedUser: () => undefined,
            formatRepositoryLabel: (value: string) => value,
        } as unknown as MobileProjectsService;
        const created = new MobileOpenRepositoryDialog(service, {});
        (created as unknown as { startImport(request: QaapGithubWorkspaceJobRequest): undefined }).startImport = request => {
            started.push(request);
            return undefined;
        };
        document.body.append(created.node);
        return { dialog: created, started };
    }

    beforeEach(() => {
        requests = [];
        script = { billingPlanId: 'starter', savedMemoryGb: 2 };
        installFetch();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        document.body.innerHTML = '';
    });

    it('Starter shows the single size as muted info with an upgrade link and opens without a memory prompt', async () => {
        script.billingPlanId = 'starter';
        const { dialog: created, started } = createDialog();
        await (created as unknown as { refreshPlanMemoryInfo(): Promise<void> }).refreshPlanMemoryInfo();

        const info = created.node.querySelector<HTMLElement>('.theia-mobile-open-repo-memory.theia-mod-info');
        expect(info?.hidden).to.equal(false);
        expect(info?.textContent).to.include('2 GB · ');
        const upgrade = info?.querySelector<HTMLButtonElement>('.theia-mobile-open-repo-memory-upgrade');
        expect(upgrade?.textContent).to.equal('Upgrade to Pro for 4 GB');

        await (created as unknown as { onSelectRepository(p: MobileProjectEntry): Promise<void> }).onSelectRepository(project());
        expect(started).to.deep.equal([{ kind: 'open', owner: 'octocat', name: 'Hello-World' }]);
        expect(requests.some(request => request.url.includes('project-resources'))).to.equal(false);
        expect(created.node.querySelector<HTMLElement>('.theia-mobile-open-repo-memory-prompt')?.hidden).to.equal(true);
    });

    it('Pro offers a 2 GB | 4 GB choice before opening and saves the picked size', async () => {
        script.billingPlanId = 'pro';
        script.savedMemoryGb = 2;
        const { dialog: created, started } = createDialog();
        const internal = created as unknown as {
            refreshPlanMemoryInfo(): Promise<void>;
            onSelectRepository(p: MobileProjectEntry): Promise<void>;
        };
        await internal.refreshPlanMemoryInfo();
        const info = created.node.querySelector<HTMLElement>('.theia-mobile-open-repo-memory.theia-mod-info');
        expect(info?.hidden).to.equal(true);

        void internal.onSelectRepository(project());
        const prompt = created.node.querySelector<HTMLElement>('.theia-mobile-open-repo-memory-prompt');
        await settle(() => prompt?.hidden === false);
        expect(prompt?.hidden).to.equal(false);
        const choices = Array.from(prompt!.querySelectorAll<HTMLButtonElement>('.theia-mobile-open-repo-memory-choice'));
        expect(choices.map(choice => choice.textContent)).to.deep.equal(['2 GB', '4 GB']);
        expect(choices[0].classList.contains('theia-mod-selected')).to.equal(true);
        expect(started).to.deep.equal([]);

        choices[1].click();
        expect(choices[1].getAttribute('aria-checked')).to.equal('true');
        prompt!.querySelector<HTMLButtonElement>('.theia-mobile-open-repo-memory-open')!.click();
        await settle(() => started.length > 0);

        const post = requests.find(request => request.method === 'POST');
        expect(post?.url).to.include('/qaap/api/billing/project-resources');
        expect(JSON.parse(post!.body!)).to.deep.equal({ repo: REPO_FULL_NAME, memoryGb: 4 });
        expect(started).to.deep.equal([{ kind: 'open', owner: 'octocat', name: 'Hello-World' }]);
        expect(prompt?.hidden).to.equal(true);
    });

    it('Pro opens without a save when the default size is kept', async () => {
        script.billingPlanId = 'pro';
        script.savedMemoryGb = 2;
        const { dialog: created, started } = createDialog();
        const internal = created as unknown as { onSelectRepository(p: MobileProjectEntry): Promise<void> };
        void internal.onSelectRepository(project());
        const prompt = created.node.querySelector<HTMLElement>('.theia-mobile-open-repo-memory-prompt');
        await settle(() => prompt?.hidden === false);
        prompt!.querySelector<HTMLButtonElement>('.theia-mobile-open-repo-memory-open')!.click();
        await settle(() => started.length > 0);
        expect(started).to.have.length(1);
        expect(requests.some(request => request.method === 'POST')).to.equal(false);
    });

    it('Pro clone shows the choice for the typed repository and posts it before cloning', async () => {
        script.billingPlanId = 'pro';
        script.savedMemoryGb = 2;
        const { dialog: created, started } = createDialog();
        const internal = created as unknown as {
            refreshPublicMemory(): Promise<void>;
            onSubmitPublic(): Promise<void>;
        };
        const input = created.node.querySelector<HTMLInputElement>('.theia-mobile-open-repo-public-input')!;
        input.value = REPO_FULL_NAME;
        await internal.refreshPublicMemory();

        const picker = created.node.querySelector<HTMLElement>('.theia-mobile-open-repo-memory-public');
        expect(picker?.hidden).to.equal(false);
        picker!.querySelector<HTMLButtonElement>('.theia-mobile-open-repo-memory-choice[data-memory-gb="4"]')!.click();

        await internal.onSubmitPublic();
        await settle(() => started.length > 0);

        expect(JSON.parse(requests.find(request => request.method === 'POST')!.body!)).to.deep.equal({ repo: REPO_FULL_NAME, memoryGb: 4 });
        expect(started).to.have.length(1);
        expect(started[0]).to.deep.include({ kind: 'clone', repository: REPO_FULL_NAME });
    });
});
