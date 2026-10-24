// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/** Environment variable holding the application-level encryption keys (`kid1:<base64>,kid2:<base64>`). */
export const QAAP_SECRETS_KEYS_ENV = 'QAAP_SECRETS_KEYS';

/** Prefix of every sealed value. Anything without it is legacy plain text and is returned unchanged. */
const SEALED_PREFIX = 'qaapenc:';
const ENVELOPE_PREFIX = 'qaapenc:v1:';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export interface QaapSecretKey {
    readonly kid: string;
    readonly key: Buffer;
}

let plaintextWarningEmitted = false;

/**
 * Parses `QAAP_SECRETS_KEYS`. An unset or blank value yields no keys (encryption disabled).
 * A malformed entry throws with its position only: the error never echoes key material.
 */
export function parseQaapSecretKeys(raw: string | undefined): QaapSecretKey[] {
    if (!raw?.trim()) {
        return [];
    }
    const keys: QaapSecretKey[] = [];
    const seen = new Set<string>();
    raw.split(',').forEach((entry, index) => {
        const position = index + 1;
        const separator = entry.indexOf(':');
        const kid = separator > 0 ? entry.slice(0, separator).trim() : '';
        const encoded = separator > 0 ? entry.slice(separator + 1).trim() : '';
        if (!KID_PATTERN.test(kid)) {
            throw new Error(`${QAAP_SECRETS_KEYS_ENV} entry ${position} is invalid: the key id must match [A-Za-z0-9_-]{1,32} (format: kid:base64-of-32-bytes)`);
        }
        if (seen.has(kid)) {
            throw new Error(`${QAAP_SECRETS_KEYS_ENV} entry ${position} is invalid: duplicate key id`);
        }
        if (!BASE64_PATTERN.test(encoded)) {
            throw new Error(`${QAAP_SECRETS_KEYS_ENV} entry ${position} is invalid: the key is not base64 (generate one with: openssl rand -base64 32)`);
        }
        const key = Buffer.from(encoded, 'base64');
        if (key.length !== KEY_BYTES) {
            throw new Error(`${QAAP_SECRETS_KEYS_ENV} entry ${position} is invalid: the key must decode to exactly ${KEY_BYTES} bytes, got ${key.length}`);
        }
        seen.add(kid);
        keys.push({ kid, key });
    });
    return keys;
}

/**
 * AES-256-GCM sealing of individual secret values for at-rest storage.
 *
 * Sealed format: `qaapenc:v1:<kid>:<iv_b64>:<ciphertext_b64>:<tag_b64>`. The additional
 * authenticated data (AAD) is the value's context (e.g. `settings:<login>:<prefId>`), so a sealed
 * value cannot be moved to another user or field and still decrypt. Encryption uses the first
 * configured key; decryption selects the key by `kid`, which allows rotation without downtime.
 */
export class QaapSecretCipher {

    constructor(protected readonly keys: readonly QaapSecretKey[] = []) { }

    /** Builds the cipher from `QAAP_SECRETS_KEYS`. Throws on a malformed key list. */
    static fromEnvironment(env: NodeJS.ProcessEnv = process.env): QaapSecretCipher {
        const keys = parseQaapSecretKeys(env[QAAP_SECRETS_KEYS_ENV]);
        if (keys.length === 0) {
            warnPlaintextInProduction(env);
        }
        return new QaapSecretCipher(keys);
    }

    /** Whether sealing is active. Without keys, values are stored and returned as plain text. */
    isEnabled(): boolean {
        return this.keys.length > 0;
    }

    /** Whether a stored value is a sealed envelope (as opposed to legacy plain text). */
    isEncrypted(value: unknown): value is string {
        return typeof value === 'string' && value.startsWith(SEALED_PREFIX);
    }

    /**
     * Seals `plain` bound to `aad`. Without a configured key the plain text is returned, so callers
     * keep working; the production warning tells the operator that this is the case.
     */
    encrypt(plain: string, aad: string): string {
        requireAad(aad);
        if (!this.isEnabled()) {
            return plain;
        }
        const [active] = this.keys;
        const iv = randomBytes(IV_BYTES);
        const cipher = createCipheriv(ALGORITHM, active.key, iv, { authTagLength: TAG_BYTES });
        cipher.setAAD(Buffer.from(aad, 'utf8'));
        const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return `${ENVELOPE_PREFIX}${active.kid}:${iv.toString('base64')}:${ciphertext.toString('base64')}:${tag.toString('base64')}`;
    }

    /**
     * Opens a sealed value bound to `aad`. Values without the `qaapenc:` prefix are legacy plain text
     * and are returned unchanged. Throws (never returns partial data) when the envelope is malformed,
     * its key is not configured, or authentication fails (wrong key, wrong AAD, or corruption).
     */
    decrypt(value: string, aad: string): string {
        requireAad(aad);
        if (!this.isEncrypted(value)) {
            return value;
        }
        if (!value.startsWith(ENVELOPE_PREFIX)) {
            throw new Error('Unsupported sealed secret version');
        }
        const parts = value.slice(ENVELOPE_PREFIX.length).split(':');
        if (parts.length !== 4) {
            throw new Error('Malformed sealed secret envelope');
        }
        const [kid, ivEncoded, ciphertextEncoded, tagEncoded] = parts;
        const key = this.keys.find(candidate => candidate.kid === kid);
        if (!key) {
            throw new Error(this.isEnabled()
                ? `No ${QAAP_SECRETS_KEYS_ENV} key with id '${kid}' is configured`
                : `${QAAP_SECRETS_KEYS_ENV} is not set; cannot decrypt sealed secret '${kid}'`);
        }
        const iv = Buffer.from(ivEncoded, 'base64');
        const tag = Buffer.from(tagEncoded, 'base64');
        if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
            throw new Error('Malformed sealed secret envelope');
        }
        try {
            const decipher = createDecipheriv(ALGORITHM, key.key, iv, { authTagLength: TAG_BYTES });
            decipher.setAAD(Buffer.from(aad, 'utf8'));
            decipher.setAuthTag(tag);
            return Buffer.concat([decipher.update(Buffer.from(ciphertextEncoded, 'base64')), decipher.final()]).toString('utf8');
        } catch {
            throw new Error('Sealed secret failed authentication (wrong key, wrong context or corrupted value)');
        }
    }
}

function requireAad(aad: string): void {
    if (!aad) {
        throw new Error('Sealed secrets require a non-empty context (AAD)');
    }
}

function warnPlaintextInProduction(env: NodeJS.ProcessEnv): void {
    if (plaintextWarningEmitted || env.NODE_ENV !== 'production') {
        return;
    }
    plaintextWarningEmitted = true;
    console.error('[qaap-secrets] QAAP_SECRETS_KEYS is not set: user secrets are stored in plain text');
}
