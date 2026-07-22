// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    isValidCronExpression,
    normalizeRoutineCronExpression,
    normalizeRoutineTimezone,
} from '@theia/qaap-mobile-shell/lib/common/qaap-work-hub-cron';
import {
    normalizeJobLoopTriggerInterval,
    QaapCreateJobLoopTriggerBody,
    QaapJobLoopTrigger,
    QaapUpdateJobLoopTriggerBody,
} from '../common/qaap-job-loop-trigger';
import { writeJsonAtomicSync } from './qaap-write-json-atomic';

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_TRIGGERS_PER_OWNER = 100;
const MAX_DELIVERIES = 256;

interface PersistedTrigger extends QaapJobLoopTrigger {
    readonly webhookSecretDigest?: string;
    readonly deliveryIds?: readonly string[];
}
interface PersistedIndex { readonly version: 1; readonly triggers: readonly PersistedTrigger[]; }

@injectable()
export class QaapJobLoopTriggerStore {

    protected readonly triggers = new Map<string, PersistedTrigger>();

    @postConstruct()
    protected init(): void { this.load(); }

    list(ownerLogin: string): QaapJobLoopTrigger[] {
        this.load();
        return [...this.triggers.values()].filter(trigger => trigger.ownerLogin === ownerLogin)
            .map(trigger => this.publicTrigger(trigger)).sort((a, b) => b.updatedAt - a.updatedAt);
    }

    listAll(): QaapJobLoopTrigger[] { this.load(); return [...this.triggers.values()].map(trigger => this.publicTrigger(trigger)); }

    get(ownerLogin: string, id: string): QaapJobLoopTrigger | undefined {
        this.load();
        const trigger = this.triggers.get(id);
        return trigger?.ownerLogin === ownerLogin ? this.publicTrigger(trigger) : undefined;
    }

    getAny(id: string): QaapJobLoopTrigger | undefined {
        this.load();
        const trigger = this.triggers.get(id);
        return trigger ? this.publicTrigger(trigger) : undefined;
    }

    create(ownerLogin: string, body: QaapCreateJobLoopTriggerBody): { trigger: QaapJobLoopTrigger; webhookSecret?: string } {
        this.load();
        if (this.list(ownerLogin).length >= MAX_TRIGGERS_PER_OWNER) {
            throw new Error('trigger_limit');
        }
        if (!body.title?.trim() || body.title.trim().length > 120 || !body.templateId?.trim()) { throw new Error('invalid_trigger'); }
        const now = Date.now();
        const type = this.typeOf(body.type);
        const secret = type === 'webhook' ? randomBytes(32).toString('base64url') : undefined;
        const trigger: PersistedTrigger = {
            id: randomUUID(), ownerLogin, templateId: body.templateId.trim(), title: body.title.trim(), type,
            enabled: body.enabled !== false, ...this.scheduleFields(type, body),
            ...(secret ? { webhookSecretDigest: this.digest(secret) } : {}), createdAt: now, updatedAt: now,
        };
        this.triggers.set(trigger.id, trigger); this.persist();
        return { trigger: this.publicTrigger(trigger), ...(secret ? { webhookSecret: secret } : {}) };
    }

    update(ownerLogin: string, id: string, patch: QaapUpdateJobLoopTriggerBody): QaapJobLoopTrigger | undefined {
        this.load();
        const previous = this.triggers.get(id);
        if (!previous || previous.ownerLogin !== ownerLogin) { return undefined; }
        if (patch.title !== undefined && (!patch.title.trim() || patch.title.trim().length > 120)) { throw new Error('invalid_trigger'); }
        if (patch.templateId !== undefined && !patch.templateId.trim()) { throw new Error('invalid_trigger'); }
        if (patch.type !== undefined && patch.type !== previous.type) {
            // Webhook credentials are intentionally returned only on creation. Keeping the kind
            // immutable prevents an unreachable webhook or a scheduled trigger retaining a secret.
            throw new Error('immutable_trigger_type');
        }
        const type = previous.type;
        const candidate = { ...previous, type, title: patch.title === undefined ? previous.title : patch.title.trim(),
            templateId: patch.templateId === undefined ? previous.templateId : patch.templateId.trim(),
            enabled: patch.enabled ?? previous.enabled, ...this.scheduleFields(type, { ...previous, ...patch }), updatedAt: Date.now() };
        this.triggers.set(id, candidate); this.persist(); return this.publicTrigger(candidate);
    }

    delete(ownerLogin: string, id: string): boolean {
        this.load();
        if (!this.get(ownerLogin, id)) { return false; }
        this.triggers.delete(id); this.persist(); return true;
    }

    verifyWebhookSecret(id: string, secret: string): boolean {
        this.load();
        const candidate = this.triggers.get(id);
        if (!candidate?.webhookSecretDigest) { return false; }
        const supplied = Buffer.from(this.digest(secret), 'hex');
        const expected = Buffer.from(candidate.webhookSecretDigest, 'hex');
        return supplied.length === expected.length && timingSafeEqual(supplied, expected);
    }

    claimDelivery(id: string, deliveryId: string | undefined): boolean {
        if (!deliveryId) { return true; }
        this.load();
        const trigger = this.triggers.get(id);
        if (!trigger) { return false; }
        const ids = trigger.deliveryIds ?? [];
        if (ids.includes(deliveryId)) { return false; }
        this.triggers.set(id, { ...trigger, deliveryIds: [...ids, deliveryId].slice(-MAX_DELIVERIES), updatedAt: Date.now() });
        this.persist(); return true;
    }

    markRun(id: string, loopId: string | undefined, state: QaapJobLoopTrigger['lastRunState']): void {
        this.load();
        const trigger = this.triggers.get(id); if (!trigger) { return; }
        this.triggers.set(id, { ...trigger, lastRunAt: Date.now(), lastLoopId: loopId, lastRunState: state,
            ...(trigger.oneShot && state === 'completed' ? { enabled: false } : {}), updatedAt: Date.now() }); this.persist();
    }

    protected typeOf(value: unknown): QaapJobLoopTrigger['type'] {
        if (value === 'interval' || value === 'cron' || value === 'webhook') { return value; }
        throw new Error('invalid_trigger');
    }
    protected scheduleFields(type: QaapJobLoopTrigger['type'], body: Partial<QaapCreateJobLoopTriggerBody>): Partial<PersistedTrigger> {
        if (type === 'interval') { return { intervalMinutes: normalizeJobLoopTriggerInterval(body.intervalMinutes), cronExpression: undefined, timezone: undefined, oneShot: undefined }; }
        if (type === 'cron') {
            const expression = body.cronExpression?.trim();
            const timezone = body.timezone?.trim();
            if (!expression || !isValidCronExpression(expression)
                || (timezone && normalizeRoutineTimezone(timezone) !== timezone)) {
                throw new Error('invalid_cron_schedule');
            }
            return {
                cronExpression: normalizeRoutineCronExpression(expression),
                timezone: normalizeRoutineTimezone(timezone),
                oneShot: body.oneShot === true,
                intervalMinutes: undefined,
            };
        }
        return { intervalMinutes: undefined, cronExpression: undefined, timezone: undefined, oneShot: undefined };
    }
    protected publicTrigger(trigger: PersistedTrigger): QaapJobLoopTrigger {
        const { webhookSecretDigest: _digest, deliveryIds: _deliveries, ...publicTrigger } = trigger; return publicTrigger;
    }
    protected digest(secret: string): string { return createHash('sha256').update(secret).digest('hex'); }
    protected directory(): string {
        return process.env.QAAP_JOB_LOOP_TRIGGER_STATE_DIR?.trim()
            || path.join(os.homedir(), '.qaap', 'job-loop-triggers');
    }
    protected indexPath(): string { return path.join(this.directory(), 'index.json'); }
    protected load(): void {
        try { const parsed = JSON.parse(fs.readFileSync(this.indexPath(), 'utf8')) as PersistedIndex;
            if (parsed.version !== 1 || !Array.isArray(parsed.triggers)) { throw new Error('Invalid persisted job loop trigger index.'); }
            const restored = new Map<string, PersistedTrigger>();
            for (const trigger of parsed.triggers) { if (trigger.id && trigger.ownerLogin && trigger.templateId && trigger.title) { restored.set(trigger.id, trigger); } }
            this.triggers.clear();
            for (const [id, trigger] of restored) { this.triggers.set(id, trigger); }
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { console.warn('[qaap-job-loop-triggers] failed to load:', error); } }
    }
    protected persist(): void {
        try { fs.mkdirSync(this.directory(), { recursive: true, mode: DIRECTORY_MODE }); fs.chmodSync(this.directory(), DIRECTORY_MODE);
            writeJsonAtomicSync(this.indexPath(), { version: 1, triggers: [...this.triggers.values()] } satisfies PersistedIndex, { mode: FILE_MODE });
        } catch (error) { console.warn('[qaap-job-loop-triggers] failed to persist:', error); }
    }
}
