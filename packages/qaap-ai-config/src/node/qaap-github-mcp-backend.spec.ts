// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { MCPOAuthAuthorizationRequiredError, MCPOAuthAuthorizationServerError } from '@theia/ai-mcp/lib/node/mcp-oauth-errors';
import type { MCPServerDescription } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import { QaapGithubMcpCredentialResolver, QaapGithubMcpRejectionVerdict } from '@theia/qaap-shared-core/lib/node/qaap-github-mcp-credential-resolver';
import { QaapGithubMcpAuthProvider } from './qaap-github-mcp-auth-provider';
import { QaapGithubMcpManagedServer, QAAP_GITHUB_MCP_NO_CREDENTIAL_CODE } from './qaap-github-mcp-managed-server';
import { QaapGithubMcpServerManagerImpl } from './qaap-github-mcp-server-manager-impl';

const SECRET = 'gho_secret_value_for_tests';

interface ResolverStub {
    token: string | undefined;
    verdict: QaapGithubMcpRejectionVerdict;
    rejectedTokens: string[];
    invalidations: number;
    mode(): 'desktop' | 'none';
    resolve(): Promise<{ token: string; source: 'env' } | undefined>;
    describe(): Promise<{ available: boolean; source: undefined; mode: 'desktop' | 'none' }>;
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
        describe: async () => ({ available: !!stub.token, source: undefined, mode: stub.mode() }),
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
        for (const readOnly of [true, false]) {
            const description = QaapGithubMcpManagedServer.describe(readOnly);
            const serialized = JSON.stringify(description);
            expect(description).to.not.have.property('serverAuthToken');
            expect(description).to.not.have.property('env');
            expect(description.autostart).to.equal(false);
            expect(serialized).to.not.contain(SECRET);
            expect(serialized).to.not.match(/gho_|ghp_|github_pat_/);
        }
    });

    it('is read-only by default and marks the read-only header only in read-only mode', () => {
        const readOnly = QaapGithubMcpManagedServer.describe(true) as MCPServerDescription & { serverUrl: string; headers: Record<string, string> };
        expect(readOnly.serverUrl).to.equal('https://api.githubcopilot.com/mcp/readonly');
        expect(readOnly.headers).to.deep.equal({ 'X-MCP-Readonly': 'true', 'X-MCP-Lockdown': 'true' });
        expect(QaapGithubMcpManagedServer.isReadOnly(readOnly)).to.equal(true);

        const writable = QaapGithubMcpManagedServer.describe(false) as MCPServerDescription & { serverUrl: string; headers: Record<string, string> };
        expect(writable.serverUrl).to.equal('https://api.githubcopilot.com/mcp/');
        expect(writable.headers).to.not.have.property('X-MCP-Readonly');
        expect(QaapGithubMcpManagedServer.isReadOnly(writable)).to.equal(false);
    });

    it('gives the managed provider only to the managed server identity', () => {
        expect(QaapGithubMcpManagedServer.matches('qaap-github', 'https://api.githubcopilot.com/mcp/readonly', { clientId: 'qaap-managed-github' })).to.equal(true);
        expect(QaapGithubMcpManagedServer.matches('qaap-github', 'https://api.githubcopilot.com/mcp/readonly', { clientId: 'other' })).to.equal(false);
        expect(QaapGithubMcpManagedServer.matches('other', 'https://api.githubcopilot.com/mcp/readonly', { clientId: 'qaap-managed-github' })).to.equal(false);
        expect(QaapGithubMcpManagedServer.matches('qaap-github', 'https://example.com/mcp', { clientId: 'qaap-managed-github' })).to.equal(false);
    });

    it('uses the stable no-credential code', () => {
        expect((QaapGithubMcpManagedServer.noCredentialError() as Error & { code?: string }).code).to.equal(QAAP_GITHUB_MCP_NO_CREDENTIAL_CODE);
    });
});

describe('QaapGithubMcpServerManagerImpl', () => {

    interface FakeServer {
        description: MCPServerDescription;
        getCachedDescription(): MCPServerDescription;
        getTools(): Promise<{ tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }> }>;
    }

    function managerWith(stub: ResolverStub): QaapGithubMcpServerManagerImpl {
        const manager = new QaapGithubMcpServerManagerImpl();
        Object.assign(manager, { credentialResolver: stub });
        return manager;
    }

    function fakeManagedServer(tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }>): FakeServer {
        const description = QaapGithubMcpManagedServer.describe(true);
        return {
            description,
            getCachedDescription: () => description,
            getTools: async () => ({ tools }),
        };
    }

    function serversOf(manager: QaapGithubMcpServerManagerImpl): Map<string, unknown> {
        return (manager as unknown as { servers: Map<string, unknown> }).servers;
    }

    it('registers the managed server on creation when the mode is not none', async () => {
        const manager = managerWith(resolverStub(undefined));
        Object.assign(manager, { oauthClientProviderFactory: {} });
        await (manager as unknown as { registerManagedServer(): Promise<void> }).registerManagedServer();
        const registered = await manager.getServerDescription('qaap-github');
        expect(registered).to.not.equal(undefined);
        expect(registered).to.not.have.property('serverAuthToken');
        expect(registered?.autostart).to.equal(false);
    });

    it('does not register the managed server in the none mode', async () => {
        const stub = resolverStub(undefined);
        stub.mode = () => 'none';
        const manager = managerWith(stub);
        Object.assign(manager, { oauthClientProviderFactory: {} });
        await (manager as unknown as { registerManagedServer(): Promise<void> }).registerManagedServer();
        expect(serversOf(manager).size).to.equal(0);
    });

    it('refuses to start the managed server without a credential, with the stable code', async () => {
        const manager = managerWith(resolverStub(undefined));
        serversOf(manager).set('qaap-github', fakeManagedServer([]));
        const error = await rejectionOf(manager.startServer('qaap-github'));
        expect((error as Error & { code?: string }).code).to.equal(QAAP_GITHUB_MCP_NO_CREDENTIAL_CODE);
    });

    it('reports the managed server as having stored credentials only when a credential exists', async () => {
        const manager = managerWith(resolverStub(SECRET));
        serversOf(manager).set('qaap-github', fakeManagedServer([]));
        expect(await manager.hasStoredOAuthCredentials('qaap-github')).to.equal(true);
        const empty = managerWith(resolverStub(undefined));
        serversOf(empty).set('qaap-github', fakeManagedServer([]));
        expect(await empty.hasStoredOAuthCredentials('qaap-github')).to.equal(false);
    });

    it('lists only tools GitHub marks read-only in read-only mode', async () => {
        const manager = managerWith(resolverStub(SECRET));
        serversOf(manager).set('qaap-github', fakeManagedServer([
            { name: 'list_issues', annotations: { readOnlyHint: true } },
            { name: 'create_issue' },
            { name: 'merge_pr', annotations: { readOnlyHint: false } },
        ]));
        const { tools } = await manager.getTools('qaap-github');
        expect(tools.map(tool => tool.name)).to.deep.equal(['list_issues']);
    });

    it('rejects calling a tool that is not read-only in read-only mode', async () => {
        const manager = managerWith(resolverStub(SECRET));
        serversOf(manager).set('qaap-github', fakeManagedServer([{ name: 'create_issue' }]));
        const error = await rejectionOf(manager.callTool('qaap-github', 'create_issue', '{}'));
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.contain('create_issue');
    });

    it('never lets a tokenless entry replace the managed server under its own name', async () => {
        const manager = managerWith(resolverStub(SECRET));
        Object.assign(manager, { oauthClientProviderFactory: {} });
        await manager.addOrUpdateServer({ name: 'qaap-github', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], autostart: true });
        const description = await manager.getServerDescription('qaap-github');
        expect(description).to.not.have.property('command');
        expect(description).to.have.property('serverUrl', 'https://api.githubcopilot.com/mcp/readonly');
    });

    it('passes a user entry named github through untouched, since github is the user\'s own name', async () => {
        const manager = managerWith(resolverStub(SECRET));
        Object.assign(manager, { oauthClientProviderFactory: {} });
        await manager.addOrUpdateServer({ name: 'github', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], autostart: true });
        expect(await manager.getServerDescription('github')).to.have.property('command', 'npx');
    });

    it('keeps a deliberate GitHub entry with its own token', async () => {
        const manager = managerWith(resolverStub(SECRET));
        Object.assign(manager, { oauthClientProviderFactory: {} });
        await manager.addOrUpdateServer({ name: 'qaap-github', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'x' }, autostart: true });
        expect(await manager.getServerDescription('qaap-github')).to.have.property('command', 'npx');
    });
});
