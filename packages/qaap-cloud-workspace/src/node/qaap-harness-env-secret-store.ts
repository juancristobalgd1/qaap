// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { KeyStoreService } from '@theia/core/lib/common/key-store';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeJsonAtomic } from './qaap-write-json-atomic';

/** Keychain service name of the harness environment values (one account per `<harnessId>/<NAME>`). */
export const QAAP_HARNESS_ENV_KEYCHAIN_SERVICE = 'qaap-harness-environment';

/** Fallback file when the OS credential store cannot be used (0600, directory 0700). */
export function defaultQaapHarnessEnvSecretFile(): string {
    return path.join(os.homedir(), '.qaap', 'secrets', 'harness-environment.json');
}

type SecretFileShape = Record<string, string>;

/**
 * Values of the environment variables of Settings → Harness. Every value is a secret: it lives in the OS
 * credential store (Theia's keytar-backed `KeyStoreService`), or, when that store cannot be loaded, in a
 * 0600 JSON file of the Qaap data directory written atomically. Values never go to the preferences, to a
 * log, to an error message or to an HTTP response; errors are reduced to a fixed message.
 *
 * Desktop app only: the routes and the runner consult it only when `isQaapHarnessLaunchOverrideRuntime()`.
 */
@injectable()
export class QaapHarnessEnvSecretStore {

    @inject(KeyStoreService) @optional()
    protected readonly keyStore: KeyStoreService | undefined;

    protected filePath = defaultQaapHarnessEnvSecretFile();
    /** Set after the first failure of the OS store: later calls go straight to the file. */
    protected keyStoreUnavailable = false;

    protected account(harnessId: string, name: string): string {
        return `${harnessId.trim().toLowerCase()}/${name}`;
    }

    async set(harnessId: string, name: string, value: string): Promise<void> {
        const account = this.account(harnessId, name);
        if (await this.tryKeyStore(store => store.setPassword(QAAP_HARNESS_ENV_KEYCHAIN_SERVICE, account, value))) {
            // A value written to the file before the keychain worked would otherwise shadow nothing but linger.
            await this.updateFile(file => { delete file[account]; });
            return;
        }
        await this.updateFile(file => { file[account] = value; });
    }

    async get(harnessId: string, name: string): Promise<string | undefined> {
        const account = this.account(harnessId, name);
        const fromKeyStore = await this.tryKeyStoreValue(store => store.getPassword(QAAP_HARNESS_ENV_KEYCHAIN_SERVICE, account));
        if (fromKeyStore !== undefined) {
            return fromKeyStore;
        }
        const fromFile = this.readFile()[account];
        return typeof fromFile === 'string' ? fromFile : undefined;
    }

    async has(harnessId: string, name: string): Promise<boolean> {
        return (await this.get(harnessId, name)) !== undefined;
    }

    async delete(harnessId: string, name: string): Promise<void> {
        const account = this.account(harnessId, name);
        await this.tryKeyStore(store => store.deletePassword(QAAP_HARNESS_ENV_KEYCHAIN_SERVICE, account));
        await this.updateFile(file => { delete file[account]; });
    }

    /** Removes every value of `harnessId` (Restore defaults, Delete harness). */
    async deleteAll(harnessId: string): Promise<void> {
        const prefix = `${harnessId.trim().toLowerCase()}/`;
        const accounts = await this.tryKeyStoreValue(store => store.keys(QAAP_HARNESS_ENV_KEYCHAIN_SERVICE));
        for (const account of accounts ?? []) {
            if (account.startsWith(prefix)) {
                await this.tryKeyStore(store => store.deletePassword(QAAP_HARNESS_ENV_KEYCHAIN_SERVICE, account));
            }
        }
        await this.updateFile(file => {
            for (const account of Object.keys(file)) {
                if (account.startsWith(prefix)) {
                    delete file[account];
                }
            }
        });
    }

    /** Values of `names` that are stored, by name. */
    async resolve(harnessId: string, names: readonly string[]): Promise<Record<string, string>> {
        const result: Record<string, string> = {};
        for (const name of names) {
            const value = await this.get(harnessId, name);
            if (value !== undefined) {
                result[name] = value;
            }
        }
        return result;
    }

    protected async tryKeyStore(work: (store: KeyStoreService) => Promise<unknown>): Promise<boolean> {
        if (!this.keyStore || this.keyStoreUnavailable) {
            return false;
        }
        try {
            await work(this.keyStore);
            return true;
        } catch {
            // Never log the error: keytar messages may echo the account; the file takes over.
            this.keyStoreUnavailable = true;
            console.warn('[qaap-harness-env] OS credential store unavailable; harness variables use the private file store.');
            return false;
        }
    }

    protected async tryKeyStoreValue<T>(work: (store: KeyStoreService) => Promise<T | undefined>): Promise<T | undefined> {
        let value: T | undefined;
        const ok = await this.tryKeyStore(async store => { value = await work(store); });
        // keytar answers `null` for a missing entry.
        // eslint-disable-next-line no-null/no-null
        return ok && value !== null ? value : undefined;
    }

    protected readFile(): SecretFileShape {
        try {
            const parsed: unknown = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as SecretFileShape : {};
        } catch {
            return {};
        }
    }

    protected async updateFile(change: (file: SecretFileShape) => void): Promise<void> {
        const exists = fs.existsSync(this.filePath);
        const file = this.readFile();
        const before = JSON.stringify(file);
        change(file);
        if (JSON.stringify(file) === before && (exists || Object.keys(file).length === 0)) {
            return;
        }
        const dir = path.dirname(this.filePath);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        fs.chmodSync(dir, 0o700);
        try {
            await writeJsonAtomic(this.filePath, file, { mode: 0o600 });
        } catch {
            throw new Error('The harness variable could not be saved.');
        }
    }
}
