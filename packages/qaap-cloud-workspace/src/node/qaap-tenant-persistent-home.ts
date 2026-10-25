// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';

/**
 * HOME entries where agent CLIs keep their sign-in state. A tenant container's HOME is on the
 * `/tmp` tmpfs, so without these links every interactive login (Claude Code, Codex, Gemini…) was
 * lost whenever the tenant backend restarted or the reaper stopped the container.
 */
export const QAAP_PERSISTENT_HOME_DIRECTORIES: readonly string[] = [
    '.claude', // Claude Code: .credentials.json, settings
    '.codex', // Codex: auth.json
    '.gemini', // Gemini CLI / Antigravity: oauth_creds.json, google_accounts.json
    '.antigravity',
    '.grok',
    '.copilot',
    '.cursor',
    '.qwen',
    '.kimi',
    '.hermes',
    '.openclaude',
    '.qaiq',
    '.config', // gh, copilot and other XDG_CONFIG_HOME users
];

/** Single files at the HOME root that hold account state (Claude Code writes through the link). */
export const QAAP_PERSISTENT_HOME_FILES: readonly string[] = [
    '.claude.json',
    '.openclaude.json',
];

/** Optional owner applied to created entries when the backend runs as root and drops agents to a uid. */
export interface QaapTenantPersistentHomeOwner {
    readonly uid: number;
    readonly gid: number;
}

/**
 * Fallback used when the backend cannot change the owner of an entry (no CAP_CHOWN): grants the
 * agent uid access to `entry` through an ACL instead. The backend still owns the entry, so the
 * ACL can be set without CAP_FOWNER. `directory` selects the directory or the file grant.
 */
export type QaapTenantPersistentHomeAccessGrant = (entry: string, directory: boolean) => void;

/**
 * Links the credential entries of a volatile tenant HOME to a directory on the tenant's private,
 * disk-backed storage. Existing entries in HOME (written before the link existed) are moved over.
 */
export namespace QaapTenantPersistentHome {

    /**
     * Every entry is attempted even when an earlier one fails, so one refused step cannot leave the
     * other sign-in links missing. Failures are reported together once all entries were tried.
     */
    export function link(
        home: string,
        persistentHome: string,
        owner?: QaapTenantPersistentHomeOwner,
        grantAccess?: QaapTenantPersistentHomeAccessGrant
    ): void {
        const failures: string[] = [];
        const attempt = (step: () => void): void => {
            try {
                step();
            } catch (error) {
                failures.push(error instanceof Error ? error.message : String(error));
            }
        };
        attempt(() => ensureDirectory(home, owner, grantAccess));
        attempt(() => ensureDirectory(persistentHome, owner, grantAccess));
        for (const entry of QAAP_PERSISTENT_HOME_DIRECTORIES) {
            attempt(() => linkEntry(home, persistentHome, entry, true, owner, grantAccess));
        }
        for (const entry of QAAP_PERSISTENT_HOME_FILES) {
            attempt(() => linkEntry(home, persistentHome, entry, false, owner, grantAccess));
        }
        if (failures.length > 0) {
            throw new Error(`Could not link ${failures.length} agent sign-in entries under ${home}: ${failures.join('; ')}`);
        }
    }

    function linkEntry(
        home: string,
        persistentHome: string,
        entry: string,
        directory: boolean,
        owner?: QaapTenantPersistentHomeOwner,
        grantAccess?: QaapTenantPersistentHomeAccessGrant
    ): void {
        const linkPath = path.join(home, entry);
        const target = path.join(persistentHome, entry);
        const current = lstat(linkPath);
        if (current?.isSymbolicLink()) {
            if (fs.readlinkSync(linkPath) === target) {
                return;
            }
            fs.unlinkSync(linkPath);
        } else if (current) {
            // Written into the tmpfs before the link existed: it is the newest state, keep it.
            fs.cpSync(linkPath, target, { recursive: true, force: true });
            fs.rmSync(linkPath, { recursive: true, force: true });
            applyOwner(target, owner, true, grantAccess);
        }
        if (directory) {
            ensureDirectory(target, owner, grantAccess);
        }
        // A missing file target is fine: the CLI creates it through the link on first write.
        fs.symlinkSync(target, linkPath);
        if (owner) {
            try {
                fs.lchownSync(linkPath, owner.uid, owner.gid);
            } catch {
                // Ownership of a symlink does not decide access: the agent reaches the target through
                // the ACLs granted on the directory or file it points to, so a refused lchown is harmless.
            }
        }
    }

    function ensureDirectory(directory: string, owner?: QaapTenantPersistentHomeOwner, grantAccess?: QaapTenantPersistentHomeAccessGrant): void {
        if (lstat(directory)) {
            return;
        }
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        applyOwner(directory, owner, false, grantAccess);
    }

    function applyOwner(entry: string, owner: QaapTenantPersistentHomeOwner | undefined, recursive: boolean, grantAccess?: QaapTenantPersistentHomeAccessGrant): void {
        if (!owner) {
            return;
        }
        const directory = fs.lstatSync(entry).isDirectory();
        try {
            fs.chownSync(entry, owner.uid, owner.gid);
        } catch (error) {
            if (!grantAccess || !isAccessRefusal(error)) {
                throw error;
            }
            grantAccess(entry, directory);
        }
        if (recursive && directory) {
            for (const child of fs.readdirSync(entry)) {
                applyOwner(path.join(entry, child), owner, true, grantAccess);
            }
        }
    }

    function isAccessRefusal(error: unknown): boolean {
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        return code === 'EPERM' || code === 'EACCES';
    }

    function lstat(entry: string): fs.Stats | undefined {
        try {
            return fs.lstatSync(entry);
        } catch {
            return undefined;
        }
    }
}
