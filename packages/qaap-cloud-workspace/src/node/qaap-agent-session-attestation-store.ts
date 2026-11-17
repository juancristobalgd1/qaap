// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { isQaapSessionAttestationAgent } from '@theia/qaap-shared-core/lib/common/qaap-agent-session-attestation';

/** How long one attested sign-in counts as `connected` before the owner must sign in again. */
export const QAAP_AGENT_SESSION_ATTESTATION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * In-memory record of "the owner just completed this harness's sign-in" for harnesses without a
 * verifiable auth probe (see `QAAP_SESSION_ATTESTATION_AGENT_IDS`). An attested pair reads as
 * `connected` (→ `session: 'signed-in'`) until the TTL expires, the backend restarts, or a turn of
 * that agent for that owner fails with an auth error ({@link revoke}), so a false positive (the CLI
 * printed success without a usable session) is corrected by the first failed turn.
 *
 * Threat model: the attestation is client-asserted. The owner always comes from the authenticated
 * session, never from the request body, so a forged attestation only lets that owner start their
 * own CLI inside their own tenant without a session; the CLI then fails on its own and revokes the
 * attestation. It never exposes operator credentials: sign-in-only harnesses run with the provider
 * keys stripped (`SHARED_PROVIDER_ONLY_ENV` in qaap-agent-provider-env.ts and
 * `SIGN_IN_ONLY_AGENT_API_KEY_ENV` in qaap-agent-task-runner-utils3.ts), independently of this store.
 */
@injectable()
export class QaapAgentSessionAttestationStore {

    protected readonly attestedAt = new Map<string, number>();

    /** Records the attestation; false (and nothing stored) for a harness that has a real probe or no owner. */
    attest(ownerLogin: string | undefined, agentId: string): boolean {
        const key = this.key(ownerLogin, agentId);
        if (!key || !isQaapSessionAttestationAgent(agentId)) {
            return false;
        }
        this.attestedAt.set(key, this.now());
        return true;
    }

    /** True while an attestation for this owner and agent exists and has not expired. */
    isAttested(ownerLogin: string | undefined, agentId: string): boolean {
        const key = this.key(ownerLogin, agentId);
        if (!key) {
            return false;
        }
        const at = this.attestedAt.get(key);
        if (at === undefined) {
            return false;
        }
        if (this.now() - at >= QAAP_AGENT_SESSION_ATTESTATION_TTL_MS) {
            this.attestedAt.delete(key);
            return false;
        }
        return true;
    }

    /** Drops the attestation; true when one existed. */
    revoke(ownerLogin: string | undefined, agentId: string): boolean {
        const key = this.key(ownerLogin, agentId);
        return !!key && this.attestedAt.delete(key);
    }

    protected key(ownerLogin: string | undefined, agentId: string): string | undefined {
        const owner = ownerLogin?.trim().toLowerCase();
        const agent = agentId.trim().toLowerCase();
        return owner && agent ? `${owner}:${agent}` : undefined;
    }

    protected now(): number {
        return Date.now();
    }
}
