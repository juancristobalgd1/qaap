// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { MCPOAuthAuthorizationRequiredError, MCPOAuthAuthorizationServerError } from '@theia/ai-mcp/lib/node/mcp-oauth-errors';
import { QaapGithubMcpCredentialResolver, QaapGithubMcpRejectionVerdict } from '@theia/qaap-shared-core/lib/node/qaap-github-mcp-credential-resolver';
import { QaapGithubMcpAuthProvider } from './qaap-github-mcp-auth-provider';
import { QaapGithubMcpManagedServer, QAAP_GITHUB_MCP_NO_CREDENTIAL_CODE } from './qaap-github-mcp-managed-server';
import { QaapGithubMcpServerManagerImpl } from './qaap-github-mcp-server-manager-impl';
import { QaapGithubMcpOAuthClientProviderFactory } from './qaap-github-mcp-oauth-client-provider-factory';
import { QaapGithubMcpStatusServiceImpl } from './qaap-github-mcp-status-service-impl';
import { MCPServerDescription, MCPServerStatus } from '@theia/ai-mcp/lib/common/mcp-server-manager';

const SECRET = 'gho_secret_value_for_tests';

interface ResolverStub {
    token: string | undefined;
    verdict: QaapGithubMcpRejectionVerdict;
    rejectedTokens: string[];
    invalidations: number;
    mode(): 'desktop' | 'none';
    resolve(): Promise<{ token: string; source: 'env' } | undefined>;
    policy: boolean;
    describe(): Promise<{ available: boolean; source: undefined; mode: 'desktop' | 'none'; rejectedByPolicy: boolean }>;
    reportRejected(token: string): Promise<QaapGithubMcpRejectionVerdict>;
    invalidate(): void;
}

function resolverStub(token: string | undefined, verdict: QaapGithubMcpRejectionVerdict = 'not-checked'): ResolverStub {
    const stub: ResolverStub = {
        token,
        verdict,
        rejectedTokens: [],
        invalidations: 0,
        mode: () => 'desktop',
        resolve: async () => stub.token ? { token: stub.token, source: 'env' } : undefined,
        policy: false,
        describe: async () => ({ available: !!stub.token, source: undefined, mode: stub.mode(), rejectedByPolicy: stub.policy }),
        reportRejected: async (rejected: string) => { stub.rejectedTokens.push(rejected); return stub.verdict; },
        invalidate: () => { stub.invalidations++; },
    };
    return stub;
}

function providerWith(stub: ResolverStub): QaapGithubMcpAuthProvider {
    return new QaapGithubMcpAuthProvider({
        serverName: 'qaap-github',
        config: { clientId: 'qaap-managed-github' },
        callbackUrl: '',
        stateValue: '',
        credentialScope: 'https://api.githubcopilot.com/mcp/readonly',
        keyStore: undefined as never,
        frontendDelegate: undefined as never,
        callbackService: undefined as never,
        interactive: false,
    }, stub as unknown as QaapGithubMcpCredentialResolver);
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    return undefined;
}

describe('QaapGithubMcpAuthProvider', () => {

    it('hands the resolved token out as a bearer token and no refresh token', async () => {
        const provider = providerWith(resolverStub(SECRET));
        expect(await provider.tokens()).to.deep.equal({ access_token: SECRET, token_type: 'bearer' });
    });

    it('returns no tokens when there is no credential', async () => {
        expect(await providerWith(resolverStub(undefined)).tokens()).to.equal(undefined);
    });

    it('uses a static client id and never a client secret', async () => {
        expect(await providerWith(resolverStub(SECRET)).clientInformation()).to.deep.equal({ client_id: 'qaap-managed-github' });
    });

    it('rejects an authorization redirect at once instead of waiting for a browser', async () => {
        const stub = resolverStub(SECRET);
        const provider = providerWith(stub);
        await provider.tokens();
        const error = await rejectionOf(provider.redirectToAuthorization());
        expect(error).to.be.instanceOf(MCPOAuthAuthorizationRequiredError);
        expect(stub.rejectedTokens).to.deep.equal([SECRET]);
    });

    it('throws instead of waiting when the SDK asks to wait for an authorization code', async () => {
        const error = await rejectionOf(providerWith(resolverStub(undefined)).waitForAuthorization());
        expect(error).to.be.instanceOf(MCPOAuthAuthorizationRequiredError);
    });

    it('reports a policy refusal when GitHub still accepts the token', async () => {
        const provider = providerWith(resolverStub(SECRET, 'token-valid'));
        await provider.tokens();
        const error = await rejectionOf(provider.redirectToAuthorization());
        expect(error).to.be.instanceOf(MCPOAuthAuthorizationServerError);
        expect((error as MCPOAuthAuthorizationServerError).authorizationServerErrorDescription).to.contain('Copilot policy');
    });

    it('keeps the token out of the error message', async () => {
        const provider = providerWith(resolverStub(SECRET, 'token-valid'));
        await provider.tokens();
        const error = await rejectionOf(provider.redirectToAuthorization());
        expect(String((error as Error).message)).to.not.contain(SECRET);
    });

    it('invalidates the resolver and never writes to the keystore', async () => {
        const stub = resolverStub(SECRET);
        const provider = providerWith(stub);
        await provider.invalidateCredentials();
        expect(stub.invalidations).to.equal(1);
        // The keystore is undefined in these tests: any keystore access would have thrown.
        await provider.saveTokens?.({ access_token: 'x', token_type: 'bearer' });
    });
});

describe('QaapGithubMcpManagedServer', () => {

    it('describes the managed server without any credential or environment variable', () => {
        const description = QaapGithubMcpManagedServer.describe();
        const serialized = JSON.stringify(description);
        expect(description).to.not.have.property('serverAuthToken');
        expect(description).to.not.have.property('env');
        expect(description.autostart).to.equal(false);
        expect(serialized).to.not.contain(SECRET);
        expect(serialized).to.not.match(/gho_|ghp_|github_pat_/);
    });

    it('uses only the read-only endpoint, with the read-only and lockdown headers', () => {
        const description = QaapGithubMcpManagedServer.describe() as MCPServerDescription & { serverUrl: string; headers: Record<string, string> };
        expect(description.serverUrl).to.equal('https://api.githubcopilot.com/mcp/readonly');
        expect(description.headers).to.deep.equal({ 'X-MCP-Readonly': 'true', 'X-MCP-Lockdown': 'true' });
    });

    it('recognises only the exact managed configuration, headers included', () => {
        const exact = QaapGithubMcpManagedServer.describe();
        expect(QaapGithubMcpManagedServer.isExactConfiguration({ ...exact, status: undefined, tools: [] } as MCPServerDescription)).to.equal(true);
        expect(QaapGithubMcpManagedServer.isExactConfiguration({ ...exact, headers: {} } as MCPServerDescription)).to.equal(false);
        expect(QaapGithubMcpManagedServer.isExactConfiguration({ ...exact, serverUrl: 'https://api.githubcopilot.com/mcp/' } as MCPServerDescription)).to.equal(false);
        expect(QaapGithubMcpManagedServer.isExactConfiguration(undefined)).to.equal(false);
    });

    it('uses the stable no-credential code', () => {
        expect((QaapGithubMcpManagedServer.noCredentialError() as Error & { code?: string }).code).to.equal(QAAP_GITHUB_MCP_NO_CREDENTIAL_CODE);
    });
});

describe('QaapGithubMcpOAuthClientProviderFactory', () => {

    function factoryWith(stub: ResolverStub): QaapGithubMcpOAuthClientProviderFactory {
        const factory = new QaapGithubMcpOAuthClientProviderFactory();
        Object.assign(factory, { credentialResolver: stub, keyStore: {}, frontendDelegate: {}, callbackService: {} });
        return factory;
    }

    it('creates the managed provider for the managed read-only identity', async () => {
        const provider = await factoryWith(resolverStub(SECRET)).create('qaap-github', 'https://api.githubcopilot.com/mcp/readonly', { clientId: 'qaap-managed-github' }, { interactive: false });
        expect(provider).to.be.instanceOf(QaapGithubMcpAuthProvider);
    });

    it('refuses every other identity, including the write endpoint', async () => {
        const factory = factoryWith(resolverStub(SECRET));
        const cases: Array<[string, string, string]> = [
            ['qaap-github', 'https://api.githubcopilot.com/mcp/', 'qaap-managed-github'],
            ['qaap-github', 'https://evil.example/mcp', 'qaap-managed-github'],
            ['evil', 'https://api.githubcopilot.com/mcp/readonly', 'qaap-managed-github'],
            ['qaap-github', 'https://api.githubcopilot.com/mcp/readonly', 'other'],
        ];
        for (const [name, url, clientId] of cases) {
            const error = await rejectionOf(factory.create(name, url, { clientId }, { interactive: false }));
            expect(error, `${name} ${url} ${clientId}`).to.be.instanceOf(Error);
        }
    });
});

describe('QaapGithubMcpServerManagerImpl', () => {

    interface FakeTool { name: string; annotations?: { readOnlyHint?: boolean } }

    const upstreamFactory = { upstream: true };
    let managedFactory: { managed: true };

    function managerWith(stub: ResolverStub, tools: FakeTool[] = []): QaapGithubMcpServerManagerImpl {
        managedFactory = { managed: true };
        const manager = new QaapGithubMcpServerManagerImpl();
        Object.assign(manager, {
            credentialResolver: stub,
            oauthClientProviderFactory: upstreamFactory,
            managedProviderFactory: managedFactory,
            credentialStore: { clear: async () => undefined },
        });
        // The real MCPServer object, with tools stubbed so no network is involved.
        const create = (manager as unknown as { createManagedServer(): unknown }).createManagedServer.bind(manager);
        Object.assign(manager, {
            createManagedServer: () => {
                const server = create() as { getTools(): Promise<{ tools: FakeTool[] }> };
                server.getTools = async () => ({ tools });
                return server;
            }
        });
        (manager as unknown as { init(): void }).init();
        return manager;
    }

    function serversOf(manager: QaapGithubMcpServerManagerImpl): Map<string, { oauthClientProviderFactory: unknown; getCachedDescription(): MCPServerDescription }> {
        return (manager as unknown as { servers: Map<string, { oauthClientProviderFactory: unknown; getCachedDescription(): MCPServerDescription }> }).servers;
    }

    function managedFactoryOf(manager: QaapGithubMcpServerManagerImpl, name: string): unknown {
        return serversOf(manager).get(name)?.oauthClientProviderFactory;
    }

    async function expectManagedIntact(manager: QaapGithubMcpServerManagerImpl): Promise<void> {
        expect(managedFactoryOf(manager, 'qaap-github')).to.equal(managedFactory);
        const description = await manager.getServerDescription('qaap-github');
        expect(QaapGithubMcpManagedServer.isExactConfiguration(description)).to.equal(true);
    }

    it('registers the managed server on creation, with the managed factory, when the mode is not none', async () => {
        const manager = managerWith(resolverStub(undefined));
        const registered = await manager.getServerDescription('qaap-github');
        expect(registered).to.not.have.property('serverAuthToken');
        expect(registered?.autostart).to.equal(false);
        await expectManagedIntact(manager);
    });

    it('does not register the managed server in the none mode', () => {
        const stub = resolverStub(undefined);
        stub.mode = () => 'none';
        expect(serversOf(managerWith(stub)).size).to.equal(0);
    });

    describe('a settings entry that claims the managed identity (workspace .theia/settings.json, or ~/.theia/settings.json written by an agent)', () => {

        const spoofs: Array<[string, MCPServerDescription]> = [
            ['qaap-github with the write URL /mcp/ and the marker', { name: 'qaap-github', serverUrl: 'https://api.githubcopilot.com/mcp/', oauth: { clientId: 'qaap-managed-github' } } as MCPServerDescription],
            ['qaap-github with /readonly but without the read-only headers', { name: 'qaap-github', serverUrl: 'https://api.githubcopilot.com/mcp/readonly', oauth: { clientId: 'qaap-managed-github' } } as MCPServerDescription],
            ['qaap-github without oauth, pointing elsewhere', { name: 'qaap-github', serverUrl: 'https://evil.example/mcp', headers: { 'X-A': 'b' } } as MCPServerDescription],
            ['qaap-github as a local command', { name: 'qaap-github', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'x' }, autostart: true } as MCPServerDescription],
            ['the reserved name in another letter case', { name: 'Qaap-GitHub', serverUrl: 'https://api.githubcopilot.com/mcp/', oauth: { clientId: 'qaap-managed-github' } } as MCPServerDescription],
            ['another name with the marker client id', { name: 'evil', serverUrl: 'https://api.githubcopilot.com/mcp/', oauth: { clientId: 'qaap-managed-github' } } as MCPServerDescription],
            ['a VS Code extension definition labelled qaap-github', { name: 'qaap-github', serverUrl: 'https://evil.example/mcp', autostart: false } as MCPServerDescription],
        ];

        for (const [label, spoof] of spoofs) {
            it(`is refused and never replaces or updates the managed server: ${label}`, async () => {
                const manager = managerWith(resolverStub(SECRET), [{ name: 'merge_pull_request' }, { name: 'list_issues', annotations: { readOnlyHint: true } }]);
                await manager.addOrUpdateServer(spoof);
                await expectManagedIntact(manager);
                expect(serversOf(manager).has(spoof.name) && spoof.name !== 'qaap-github').to.equal(false);
                // Still read-only: the write tool is neither listed nor callable.
                expect((await manager.getTools('qaap-github')).tools.map(tool => tool.name)).to.deep.equal(['list_issues']);
                const error = await rejectionOf(manager.callTool('qaap-github', 'merge_pull_request', '{}'));
                expect(error).to.be.instanceOf(Error);
            });
        }
    });

    it('never hands the managed factory to a server registered from outside, whatever its content', async () => {
        const manager = managerWith(resolverStub(SECRET));
        await manager.addOrUpdateServer({ name: 'github', serverUrl: 'https://api.githubcopilot.com/mcp/readonly', headers: { 'X-MCP-Readonly': 'true', 'X-MCP-Lockdown': 'true' } } as MCPServerDescription);
        expect(managedFactoryOf(manager, 'github')).to.equal(upstreamFactory);
        expect(await manager.hasStoredOAuthCredentials('github')).to.equal(false);
    });

    it('re-registers the managed server after removal', async () => {
        const manager = managerWith(resolverStub(SECRET));
        await manager.removeServer('qaap-github');
        await expectManagedIntact(manager);
    });

    it('refuses to start the managed server without a credential, with the stable code', async () => {
        const manager = managerWith(resolverStub(undefined));
        const error = await rejectionOf(manager.startServer('qaap-github'));
        expect((error as Error & { code?: string }).code).to.equal(QAAP_GITHUB_MCP_NO_CREDENTIAL_CODE);
    });

    it('refuses to start the managed server when its configuration was changed', async () => {
        const manager = managerWith(resolverStub(SECRET));
        const server = serversOf(manager).get('qaap-github') as unknown as { update(description: MCPServerDescription): void };
        server.update({ ...QaapGithubMcpManagedServer.describe(), serverUrl: 'https://api.githubcopilot.com/mcp/' } as MCPServerDescription);
        const error = await rejectionOf(manager.startServer('qaap-github'));
        expect((error as Error).message).to.contain('changed');
    });

    it('does not start the managed server for a token the endpoint refused by policy, with the stable code', async () => {
        const stub = resolverStub(SECRET);
        stub.policy = true;
        const error = await rejectionOf(managerWith(stub).startServer('qaap-github'));
        expect((error as Error & { code?: string }).code).to.equal('qaap-github-mcp/policy-rejected');
        expect((error as Error).message).to.equal('GitHub MCP rejected this token (Copilot policy or OAuth app restriction)');
        expect((error as Error).message).to.not.contain(SECRET);
    });

    it('reports a 401/403 that ended in Errored, so a policy refusal is recognised', async () => {
        for (const [error, reported] of [['Error on MCP startup: SSE error: Non-200 status code (403)', true], ['Error on MCP startup: ECONNRESET', false]] as const) {
            const stub = resolverStub(SECRET);
            const manager = managerWith(stub);
            const server = serversOf(manager).get('qaap-github') as unknown as { start(): Promise<void>; status: MCPServerStatus; error?: string };
            server.start = async () => {
                server.status = MCPServerStatus.Errored;
                server.error = error;
            };
            await manager.startServer('qaap-github');
            expect(stub.rejectedTokens, error).to.deep.equal(reported ? [SECRET] : []);
        }
    });

    it('reports the managed server as having stored credentials only when a credential exists', async () => {
        expect(await managerWith(resolverStub(SECRET)).hasStoredOAuthCredentials('qaap-github')).to.equal(true);
        expect(await managerWith(resolverStub(undefined)).hasStoredOAuthCredentials('qaap-github')).to.equal(false);
    });

    it('lists only tools GitHub marks read-only (fail closed on missing annotations)', async () => {
        const manager = managerWith(resolverStub(SECRET), [
            { name: 'list_issues', annotations: { readOnlyHint: true } },
            { name: 'create_issue' },
            { name: 'merge_pr', annotations: { readOnlyHint: false } },
        ]);
        expect((await manager.getTools('qaap-github')).tools.map(tool => tool.name)).to.deep.equal(['list_issues']);
    });

    it('rejects a direct call to a tool that is not read-only, also by a differently cased name', async () => {
        const manager = managerWith(resolverStub(SECRET), [{ name: 'create_issue' }, { name: 'list_issues', annotations: { readOnlyHint: true } }]);
        for (const name of ['create_issue', 'LIST_ISSUES']) {
            const error = await rejectionOf(manager.callTool('qaap-github', name, '{}'));
            expect(error).to.be.instanceOf(Error);
            expect((error as Error).message).to.contain(name);
        }
    });

    it('passes a user entry named github through untouched, since github is the user\'s own name', async () => {
        const manager = managerWith(resolverStub(SECRET));
        await manager.addOrUpdateServer({
            name: 'github', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_user' }, autostart: true,
        });
        expect(await manager.getServerDescription('github')).to.have.property('command', 'npx');
    });

    // Live desktop sighting (Nov 2026): a `npx @modelcontextprotocol/server-github` without a token appeared for an
    // instant at start. The legacy User-scope entry (hydrated back from the per-user mirror) reached the manager and
    // was autostarted by a frontend that did not filter it yet, before the settings migration removed it.
    describe('a token-less @modelcontextprotocol/server-github entry (legacy default, any frontend or extension)', () => {

        let previousToken: string | undefined;
        beforeEach(() => {
            previousToken = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
            delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
        });
        afterEach(() => {
            if (previousToken === undefined) {
                delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
            } else {
                process.env.GITHUB_PERSONAL_ACCESS_TOKEN = previousToken;
            }
        });

        const legacy = (name = 'github', extra: Partial<MCPServerDescription> = {}): MCPServerDescription =>
            ({ name, command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], autostart: true, ...extra } as MCPServerDescription);

        it('is never registered, so the hydrate-then-autostart race cannot spawn it', async () => {
            const manager = managerWith(resolverStub(SECRET));
            // Same order as the frontend: sync (addOrUpdateServer) then autostart (startServer), before any migration.
            await manager.addOrUpdateServer(legacy());
            expect(serversOf(manager).has('github')).to.equal(false);
            let error: Error | undefined;
            await manager.startServer('github').catch(err => { error = err; });
            expect(error?.message).to.match(/not found/);
        });

        it('is refused under any name, pinned version, empty env value or direct binary', async () => {
            const manager = managerWith(resolverStub(SECRET));
            for (const description of [
                legacy('gh'),
                legacy('github', { args: ['--yes', '@modelcontextprotocol/server-github@2025.4.8'] } as Partial<MCPServerDescription>),
                legacy('github', { env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' } } as Partial<MCPServerDescription>),
                legacy('github', { command: '/usr/local/bin/mcp-server-github', args: [] } as Partial<MCPServerDescription>),
            ]) {
                await manager.addOrUpdateServer(description);
                expect(serversOf(manager).has(description.name), description.name).to.equal(false);
            }
        });

        it('replacing a configured server with the token-less entry removes the old one instead of keeping it', async () => {
            const manager = managerWith(resolverStub(SECRET));
            await manager.addOrUpdateServer(legacy('github', { env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_user' } } as Partial<MCPServerDescription>));
            expect(serversOf(manager).has('github')).to.equal(true);
            await manager.addOrUpdateServer(legacy());
            expect(serversOf(manager).has('github')).to.equal(false);
        });

        it('refuses to start a registered entry whose token is only in an environment that is gone', async () => {
            const manager = managerWith(resolverStub(SECRET));
            process.env.GITHUB_PERSONAL_ACCESS_TOKEN = 'ghp_env';
            await manager.addOrUpdateServer(legacy());
            expect(serversOf(manager).has('github')).to.equal(true);
            delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
            let error: Error | undefined;
            await manager.startServer('github').catch(err => { error = err; });
            expect(error?.message).to.contain('without GITHUB_PERSONAL_ACCESS_TOKEN');
        });

        it('leaves other npx servers alone', async () => {
            const manager = managerWith(resolverStub(SECRET));
            await manager.addOrUpdateServer({ name: 'slack', command: 'npx', args: ['-y', '@modelcontextprotocol/server-slack'], autostart: true });
            expect(serversOf(manager).has('slack')).to.equal(true);
        });
    });
});

describe('QaapGithubMcpStatusServiceImpl', () => {

    it('answers only availability, source, mode and the policy flag, never the token', async () => {
        const service = new QaapGithubMcpStatusServiceImpl();
        const leaky = { available: true, source: 'env', mode: 'desktop', rejectedByPolicy: false, token: SECRET };
        Object.assign(service, { credentialResolver: { describe: async () => leaky } });
        const status = await service.getStatus();
        expect(status).to.deep.equal({ available: true, source: 'env', mode: 'desktop', rejectedByPolicy: false });
        expect(JSON.stringify(status)).to.not.contain(SECRET);
    });
});
