// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Application, Request, Response } from '@theia/core/shared/express';
import { json } from 'body-parser';
import { BackendApplicationContribution, FileUri } from '@theia/core/lib/node';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import {
    QAAP_CDP_PROBE_URL,
    QAAP_CLOUD_API_PATH,
    type QaapCdpStatusResponse,
    type QaapCloudWorkspaceEnsureRequest,
    type QaapDeployEnvVar,
    type QaapDeployRunRequest,
    type QaapPreviewShareCreateRequest,
    type QaapPushNotifyRequest,
    type QaapPushSubscribeRequest,
    type QaapTerminalSessionsUpsertRequest,
} from '../common/qaap-cloud-api-types';
import {
    buildQaapIdentityPreviewUrl,
    isAllowedDevPreviewPort,
    parseQaapDevPreviewPort,
} from '@theia/qaap-mobile-shell/lib/common/qaap-dev-preview';
import {
    isQaapPreviewIdentity,
    resolveQaapPreviewIdentity,
} from '@theia/qaap-mobile-shell/lib/common/qaap-preview-identity';
import { QaapDevPreviewPortRegistry } from '@theia/qaap-mobile-shell/lib/node/qaap-dev-preview-port-registry';
import { QAAP_PREVIEW_RESTART_PATH, type QaapPreviewRestartRequest } from '../common/qaap-preview-supervisor-types';
import { QaapCloudOrchestrator } from './qaap-cloud-orchestrator';
import { writeJsonAtomic } from './qaap-write-json-atomic';
import { QaapCloudWorkspaceStore } from './qaap-cloud-workspace-store';
import { QaapDeployRunner } from './qaap-deploy-runner';
import { QaapPreviewShareStore } from './qaap-preview-share-store';
import { QaapPreviewSupervisor } from './qaap-preview-supervisor';
import { QaapPushSubscriptionStore } from './qaap-push-subscription-store';
import { QaapTerminalSessionStore } from './qaap-terminal-session-store';
import { QaapPreviewShareProxyContribution } from './qaap-preview-share-proxy';
import { QaapWebPushService } from './qaap-web-push-service';
import { normalizeQaapPublicUrl } from '@theia/qaap-mobile-shell/lib/node/qaap-github-oauth-config';
import { QaapGithubAuthGuard, type QaapGithubAuthContext } from '@theia/qaap-mobile-shell/lib/node/qaap-github-auth-guard';

@injectable()
export class QaapCloudWorkspaceEndpoint implements BackendApplicationContribution {

    @inject(QaapCloudWorkspaceStore)
    protected readonly workspaces: QaapCloudWorkspaceStore;

    @inject(QaapCloudOrchestrator)
    protected readonly orchestrator: QaapCloudOrchestrator;

    @inject(QaapDeployRunner)
    protected readonly deployRunner: QaapDeployRunner;

    @inject(QaapPushSubscriptionStore)
    protected readonly pushSubscriptions: QaapPushSubscriptionStore;

    @inject(QaapWebPushService)
    protected readonly webPush: QaapWebPushService;

    @inject(QaapPreviewShareStore)
    protected readonly shares: QaapPreviewShareStore;

    @inject(QaapPreviewSupervisor)
    protected readonly previewSupervisor: QaapPreviewSupervisor;

    @inject(QaapDevPreviewPortRegistry)
    protected readonly previewRegistry: QaapDevPreviewPortRegistry;

    @inject(QaapTerminalSessionStore)
    protected readonly terminals: QaapTerminalSessionStore;

    @inject(QaapPreviewShareProxyContribution)
    protected readonly shareProxy: QaapPreviewShareProxyContribution;

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    configure(app: Application): void {
        app.use(json());
        app.get(`${QAAP_CLOUD_API_PATH}/workspaces`, (req, res) => { void this.handleListWorkspaces(req, res); });
        app.post(`${QAAP_CLOUD_API_PATH}/workspaces/ensure`, (req, res) => { void this.handleEnsureWorkspace(req, res); });
        app.post(`${QAAP_CLOUD_API_PATH}/preview/share`, (req, res) => { void this.handleCreateShare(req, res); });
        app.post(`${QAAP_CLOUD_API_PATH}/preview/share/revoke`, (req, res) => { void this.handleRevokeShare(req, res); });
        app.post(QAAP_PREVIEW_RESTART_PATH, (req, res) => { void this.handleRestartPreview(req, res); });
        app.get(`${QAAP_CLOUD_API_PATH}/terminal-sessions`, (req, res) => { void this.handleGetTerminalSessions(req, res); });
        app.post(`${QAAP_CLOUD_API_PATH}/terminal-sessions`, (req, res) => { void this.handleUpsertTerminalSessions(req, res); });
        app.get(`${QAAP_CLOUD_API_PATH}/deploy/env`, (req, res) => { void this.handleGetDeployEnv(req, res); });
        app.post(`${QAAP_CLOUD_API_PATH}/deploy/env`, (req, res) => { void this.handleSetDeployEnv(req, res); });
        app.post(`${QAAP_CLOUD_API_PATH}/deploy/run`, (req, res) => { void this.handleDeployRun(req, res); });
        app.get(`${QAAP_CLOUD_API_PATH}/push/vapid`, (req, res) => { void this.handlePushVapid(req, res); });
        app.post(`${QAAP_CLOUD_API_PATH}/push/subscribe`, (req, res) => { void this.handlePushSubscribe(req, res); });
        app.post(`${QAAP_CLOUD_API_PATH}/push/notify`, (req, res) => { void this.handlePushNotify(req, res); });
        app.get(`${QAAP_CLOUD_API_PATH}/cdp-status`, (req, res) => { void this.handleCdpStatus(req, res); });
        this.shareProxy.configure(app);
    }

    /**
     * Probes the local CDP endpoint AppTester relies on (Chrome with --remote-debugging-port=9222).
     * Returns `{ reachable: false }` quickly when there's no Chrome — used by the mobile AppTester
     * auto-trigger to avoid asking the user to start the MCP server in environments where it
     * would just hang or fail later inside a tool call.
     */
    protected async handleCdpStatus(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const reachable = await this.probeCdpEndpoint();
        const body: QaapCdpStatusResponse = { reachable, endpoint: QAAP_CDP_PROBE_URL };
        res.json(body);
    }

    protected probeCdpEndpoint(): Promise<boolean> {
        return new Promise(resolve => {
            const req = http.get(QAAP_CDP_PROBE_URL, { timeout: 750 }, response => {
                response.resume();
                resolve(response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 500);
            });
            req.on('timeout', () => { req.destroy(); resolve(false); });
            req.on('error', () => resolve(false));
        });
    }

    protected async handleListWorkspaces(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const ownerLogin = ctx.kind === 'authenticated' ? ctx.userLogin : undefined;
        res.json({ workspaces: await this.workspaces.list(ownerLogin) });
    }

    protected async handleEnsureWorkspace(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const body = (req.body ?? {}) as Partial<QaapCloudWorkspaceEnsureRequest>;
        if (!body.repoKey || typeof body.repoKey !== 'string') {
            res.status(400).json({ error: 'repoKey is required' });
            return;
        }
        const ownerLogin = ctx.kind === 'authenticated' ? ctx.userLogin : undefined;
        // A client-supplied workspaceUri becomes a Docker bind-mount source, so it must resolve to a
        // path the caller owns — otherwise a tenant could mount another user's tree (or /root/.qaap)
        // into their own container. skip-auth (local single-user) is exempt. (SEC-2)
        if (body.workspaceUri && ctx.kind !== 'skip') {
            const targetPath = body.workspaceUri.startsWith('file://')
                ? FileUri.fsPath(body.workspaceUri)
                : path.resolve(body.workspaceUri);
            if (!this.auth.ownsWorkspacePath(ctx, targetPath)) {
                this.auth.denyForbidden(res, req, 'workspace_path', { repoKey: body.repoKey });
                return;
            }
        }
        const workspace = await this.orchestrator.ensure({
            repoKey: body.repoKey,
            workspaceUri: body.workspaceUri,
            githubFullName: body.githubFullName,
        }, ownerLogin);
        res.json({ workspace });
    }

    protected async handleDeployRun(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const body = (req.body ?? {}) as Partial<QaapDeployRunRequest>;
        if (!body.provider || !body.workspaceKey || !body.workspaceRoot) {
            res.status(400).json({ error: 'provider, workspaceKey, and workspaceRoot are required' });
            return;
        }
        if (ctx.kind !== 'skip' && !this.auth.ownsWorkspacePath(ctx, body.workspaceRoot)) {
            this.auth.denyForbidden(res, req, 'workspace_path', { workspaceKey: body.workspaceKey });
            return;
        }
        const ownerLogin = ctx.kind === 'authenticated' ? ctx.userLogin : undefined;
        const result = await this.deployRunner.run({
            provider: body.provider,
            workspaceKey: body.workspaceKey,
            workspaceRoot: body.workspaceRoot,
            projectName: body.projectName,
        }, ownerLogin);
        res.json(result);
    }

    protected async handlePushVapid(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        res.json({
            publicKey: this.webPush.getPublicKey(),
            enabled: this.webPush.isConfigured(),
        });
    }

    protected async handlePushSubscribe(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const body = (req.body ?? {}) as Partial<QaapPushSubscribeRequest>;
        const login = ctx.kind === 'authenticated' ? ctx.userLogin : (ctx.kind === 'skip' ? ctx.userLogin : 'anonymous');
        if (!body.subscription?.endpoint || !body.subscription.keys?.p256dh || !body.subscription.keys.auth) {
            res.status(400).json({ error: 'subscription is required' });
            return;
        }
        await this.pushSubscriptions.upsert(login, body.subscription);
        res.json({ ok: true });
    }

    protected async handlePushNotify(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const body = (req.body ?? {}) as Partial<QaapPushNotifyRequest>;
        if (!body.title || !body.body) {
            res.status(400).json({ error: 'title and body are required' });
            return;
        }
        // Always the session-derived login — never a client-supplied body field, which would let a
        // caller push notifications into another tenant's subscriptions.
        const targetLogin = ctx.kind === 'authenticated' || ctx.kind === 'skip' ? ctx.userLogin : undefined;
        const stats = await this.webPush.notify({
            title: body.title,
            body: body.body,
            tag: body.tag,
            userLogin: targetLogin,
            route: body.route,
            conversationId: body.conversationId,
            cwd: body.cwd,
        });
        res.json(stats);
    }

    protected async handleCreateShare(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const body = (req.body ?? {}) as Partial<QaapPreviewShareCreateRequest>;
        const port = typeof body.port === 'number' ? body.port : Number(body.port);
        if (!Number.isInteger(port) || port < 1024) {
            res.status(400).json({ error: 'port is required' });
            return;
        }
        const origin = this.resolvePublicOrigin(req);
        const ownerLogin = ctx.kind === 'authenticated' ? ctx.userLogin : undefined;
        if (body.repoKey) {
            const updated = await this.workspaces.updatePreviewPort(body.repoKey, port, ownerLogin);
            if (!updated) {
                res.status(403).json({ error: 'repoKey is not owned by the authenticated user' });
                return;
            }
        }
        const summary = await this.shares.create(port, body.repoKey, origin, ownerLogin);
        res.json({ share: summary });
    }

    /** Revokes a public preview share. Only the share's owner (or a skip-auth dev) may revoke it. */
    protected async handleRevokeShare(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const body = (req.body ?? {}) as { token?: unknown };
        const token = typeof body.token === 'string' ? body.token : '';
        if (!token) {
            res.status(400).json({ error: 'token is required' });
            return;
        }
        // Scope to the authenticated owner; skip-auth (single-user dev) may revoke any share.
        const ownerLogin = ctx.kind === 'authenticated' ? ctx.userLogin : undefined;
        const revoked = await this.shares.revoke(token, ownerLogin);
        res.json({ revoked });
    }

    /**
     * Restarts (or starts) the dev server for a workspace so the friendly preview-failure page's
     * Restart button can recover a crashed preview without leaving the app. Ownership of the target
     * cwd is enforced exactly like {@link handleDeployRun}.
     */
    protected async handleRestartPreview(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const body = (req.body ?? {}) as Partial<QaapPreviewRestartRequest>;
        const port = parseQaapDevPreviewPort(body.port);
        if (port === undefined || !isAllowedDevPreviewPort(port)) {
            res.status(400).json({ error: 'A valid dev preview port is required' });
            return;
        }
        const cwd = typeof body.cwd === 'string' ? body.cwd.trim() : '';
        if (!cwd) {
            res.status(400).json({ error: 'cwd is required' });
            return;
        }
        if (ctx.kind !== 'skip' && !this.auth.ownsWorkspacePath(ctx, cwd)) {
            this.auth.denyForbidden(res, req, 'workspace_path', { port });
            return;
        }
        const ownerLogin = ctx.kind === 'authenticated' || ctx.kind === 'skip' ? ctx.userLogin : undefined;
        if (ownerLogin && isQaapPreviewIdentity(body)) {
            const identity = resolveQaapPreviewIdentity(body);
            const record = this.previewRegistry.register({
                ...identity,
                ownerLogin,
                root: cwd,
                port,
            });
            if (!record) {
                res.status(409).json({ error: 'The preview identity or port is already reserved.' });
                return;
            }
            try {
                const status = this.previewSupervisor.start(cwd, port, { ...identity, ownerLogin });
                const processId = this.previewSupervisor.describe(identity.previewId)?.processId;
                this.previewRegistry.attachProcess(identity.previewId, ownerLogin, processId);
                res.json({
                    status,
                    port,
                    previewId: identity.previewId,
                    previewUrl: buildQaapIdentityPreviewUrl(this.resolvePublicOrigin(req), identity.previewId),
                });
            } catch (error) {
                res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
            }
            return;
        }
        // No identity in the request (the failure page only posts {port, cwd}): recover the
        // identity from the port registry instead of falling back to the port-keyed supervisor
        // record, so a restarted preview keeps its previewId and stays owner-scoped.
        if (ownerLogin) {
            const record = this.previewRegistry.getByPort(port);
            if (record && record.ownerLogin === ownerLogin && this.sameWorkspacePath(record.root, cwd)) {
                try {
                    const status = this.previewSupervisor.start(cwd, port, { ...record, ownerLogin });
                    const processId = this.previewSupervisor.describe(record.previewId)?.processId;
                    this.previewRegistry.attachProcess(record.previewId, ownerLogin, processId);
                    res.json({
                        status,
                        port,
                        previewId: record.previewId,
                        previewUrl: buildQaapIdentityPreviewUrl(this.resolvePublicOrigin(req), record.previewId),
                    });
                } catch (error) {
                    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
                }
                return;
            }
        }
        const status = this.previewSupervisor.start(cwd, port);
        res.json({ status, port });
    }

    protected sameWorkspacePath(a: string, b: string): boolean {
        try {
            return path.resolve(a) === path.resolve(b)
                || fs.realpathSync.native(path.resolve(a)) === fs.realpathSync.native(path.resolve(b));
        } catch {
            return path.resolve(a) === path.resolve(b);
        }
    }

    protected async handleGetTerminalSessions(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const workspaceKey = typeof req.query.workspaceKey === 'string' ? req.query.workspaceKey : '';
        if (!workspaceKey) {
            res.status(400).json({ error: 'workspaceKey is required' });
            return;
        }
        const ownerLogin = ctx.kind === 'authenticated' ? ctx.userLogin : undefined;
        res.json({ workspaceKey, terminals: await this.terminals.get(workspaceKey, ownerLogin) });
    }

    protected async handleUpsertTerminalSessions(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const body = (req.body ?? {}) as Partial<QaapTerminalSessionsUpsertRequest>;
        if (!body.workspaceKey || !Array.isArray(body.terminals)) {
            res.status(400).json({ error: 'workspaceKey and terminals are required' });
            return;
        }
        const ownerLogin = ctx.kind === 'authenticated' ? ctx.userLogin : undefined;
        await this.terminals.upsert({
            workspaceKey: body.workspaceKey,
            terminals: body.terminals,
        }, ownerLogin);
        res.json({ ok: true });
    }

    protected async handleGetDeployEnv(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const workspaceKey = typeof req.query.workspaceKey === 'string' ? req.query.workspaceKey : 'default';
        const ownerLogin = ctx.kind === 'authenticated' ? ctx.userLogin : undefined;
        res.json({ vars: await this.readDeployEnv(workspaceKey, ownerLogin) });
    }

    protected async handleSetDeployEnv(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const workspaceKey = typeof req.body?.workspaceKey === 'string' ? req.body.workspaceKey : 'default';
        const vars = Array.isArray(req.body?.vars) ? req.body.vars as QaapDeployEnvVar[] : [];
        const ownerLogin = ctx.kind === 'authenticated' ? ctx.userLogin : undefined;
        await this.writeDeployEnv(workspaceKey, vars.filter(v => v.key?.trim()), ownerLogin);
        res.json({ vars: await this.readDeployEnv(workspaceKey, ownerLogin) });
    }

    protected deployEnvPath(workspaceKey: string, ownerLogin?: string): string {
        const safe = workspaceKey.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
        const userSegment = ownerLogin ? `${ownerLogin.replace(/[^a-zA-Z0-9._-]+/g, '_')}/` : '';
        return `${process.env.HOME ?? ''}/.qaap/deploy-env/${userSegment}${safe}.json`;
    }

    protected async readDeployEnv(workspaceKey: string, ownerLogin?: string): Promise<QaapDeployEnvVar[]> {
        try {
            const fs = await import('fs/promises');
            const raw = await fs.readFile(this.deployEnvPath(workspaceKey, ownerLogin), 'utf8');
            const parsed = JSON.parse(raw) as { vars?: QaapDeployEnvVar[] };
            return Array.isArray(parsed.vars) ? parsed.vars : [];
        } catch {
            return [];
        }
    }

    protected async writeDeployEnv(workspaceKey: string, vars: QaapDeployEnvVar[], ownerLogin?: string): Promise<void> {
        const fs = await import('fs/promises');
        const path = await import('path');
        const file = this.deployEnvPath(workspaceKey, ownerLogin);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await writeJsonAtomic(file, { vars });
    }

    protected requireAuth(req: Request, res: Response): QaapGithubAuthContext | undefined {
        const ctx = this.auth.authenticate(req);
        if (ctx.kind === 'unauthorized') {
            res.status(401).json({ error: 'Not signed in' });
            return undefined;
        }
        return ctx;
    }

    protected resolvePublicOrigin(req: Request): string {
        const envUrl = process.env.QAAP_OAUTH_PUBLIC_URL?.trim();
        if (envUrl) {
            return normalizeQaapPublicUrl(envUrl);
        }
        const proto = this.firstHeader(req.headers['x-forwarded-proto']) ?? req.protocol ?? 'http';
        const host = this.firstHeader(req.headers['x-forwarded-host']) ?? req.get('host') ?? 'localhost';
        return normalizeQaapPublicUrl(`${proto}://${host}`);
    }

    protected firstHeader(value: string | string[] | undefined): string | undefined {
        if (Array.isArray(value)) {
            return value[0]?.split(',')[0]?.trim();
        }
        return value?.split(',')[0]?.trim();
    }
}
