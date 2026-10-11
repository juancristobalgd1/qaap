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

/** Optional owner attempted for newly-created HOME directories. ACLs provide access if chown is denied. */
export interface QaapTenantPersistentHomeOwner {
    readonly uid: number;
    readonly gid: number;
}

export type QaapTenantPersistentHomeChown = (path: string, uid: number, gid: number) => void;

/**
 * Links the credential entries of a volatile tenant HOME to a directory on the tenant's private,
 * disk-backed storage. Existing entries in HOME (written before the link existed) are moved over.
 * Ownership changes are best effort and limited to the volatile HOME root; recursive access
 * repair is performed with ACLs by the spawn service so it does not need CAP_CHOWN.
 */
export namespace QaapTenantPersistentHome {

    export function link(
        home: string,
        persistentHome: string,
        owner?: QaapTenantPersistentHomeOwner,
        chown: QaapTenantPersistentHomeChown = fs.chownSync
    ): string[] {
        ensureDirectory(home, owner, chown);
        ensureDirectory(persistentHome);
        if (owner) {
            fs.chmodSync(persistentHome, 0o1700);
        }
        const changedEntries: string[] = [];
        for (const entry of QAAP_PERSISTENT_HOME_DIRECTORIES) {
            if (linkEntry(home, persistentHome, entry, true, owner, chown)) {
                changedEntries.push(resolveEntry(persistentHome, entry));
            }
        }
        for (const entry of QAAP_PERSISTENT_HOME_FILES) {
            if (linkEntry(home, persistentHome, entry, false, owner, chown)) {
                changedEntries.push(resolveEntry(persistentHome, entry));
            }
        }
        return changedEntries;
    }

    /** Create a directory path one component at a time and reject symlink components. */
    export function ensureDirectory(
        directory: string,
        owner?: QaapTenantPersistentHomeOwner,
        chown: QaapTenantPersistentHomeChown = fs.chownSync
    ): void {
        const resolved = path.resolve(directory);
        const root = path.parse(resolved).root;
        let current = root;
        for (const component of resolved.slice(root.length).split(path.sep).filter(Boolean)) {
            current = path.join(current, component);
            let stats = lstat(current);
            if (!stats) {
                try {
                    fs.mkdirSync(current, { mode: 0o700 });
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
                        throw error;
                    }
                }
                stats = lstat(current);
            }
            if (!stats || stats.isSymbolicLink() || !stats.isDirectory()) {
                throw new Error(`Refusing to use a non-directory or symlink in persistent agent HOME: ${current}`);
            }
        }
        if (owner) {
            tryChown(resolved, owner, chown);
            const stats = lstat(resolved);
            if (!stats || stats.isSymbolicLink() || !stats.isDirectory()) {
                throw new Error(`Refusing to set permissions on a missing or symbolic-link directory: ${resolved}`);
            }
            const mode = stats.mode & 0o7777;
            const privateMode = (mode | 0o700) & ~0o077;
            if (privateMode !== mode && stats.uid === backendOwnerUid()) {
                fs.chmodSync(resolved, privateMode);
            }
        }
    }

    function linkEntry(
        home: string,
        persistentHome: string,
        entry: string,
        directory: boolean,
        owner?: QaapTenantPersistentHomeOwner,
        chown: QaapTenantPersistentHomeChown = fs.chownSync
    ): boolean {
        const linkPath = resolveEntry(home, entry);
        const target = resolveEntry(persistentHome, entry);
        const current = lstat(linkPath);
        const targetStats = lstat(target);
        if (targetStats?.isSymbolicLink()) {
            throw new Error(`Refusing a symlink in persistent agent HOME: ${target}`);
        }
        if (current?.isSymbolicLink()) {
            if (fs.readlinkSync(linkPath) === target) {
                if (directory) {
                    if (targetStats && !targetStats.isDirectory()) {
                        throw new Error(`Persistent agent HOME entry is not a directory: ${target}`);
                    }
                    ensureDirectory(target);
                    if (owner && targetStats?.uid === backendOwnerUid()) {
                        fs.chmodSync(target, 0o700);
                    }
                } else if (targetStats && owner && targetStats.uid === backendOwnerUid()) {
                    fs.chmodSync(target, targetStats.mode & 0o7700);
                }
                return false;
            }
            fs.unlinkSync(linkPath);
        } else if (current) {
            // Written into the tmpfs before the link existed: this is the newest state, keep it.
            // fs.cpSync preserves symlinks as links and does not traverse their targets.
            fs.cpSync(linkPath, target, { recursive: true, force: true, dereference: false });
            fs.rmSync(linkPath, { recursive: true, force: true });
            if (directory) {
                ensureDirectory(target);
                const targetStatsAfterCopy = lstat(target);
                if (owner && targetStatsAfterCopy?.uid === backendOwnerUid()) {
                    fs.chmodSync(target, 0o700);
                }
            } else if (owner) {
                const targetStatsAfterCopy = lstat(target);
                if (targetStatsAfterCopy && !targetStatsAfterCopy.isSymbolicLink() && targetStatsAfterCopy.uid === backendOwnerUid()) {
                    fs.chmodSync(target, targetStatsAfterCopy.mode & 0o7700);
                }
            }
            fs.symlinkSync(target, linkPath);
            return true;
        }
        if (directory) {
            ensureDirectory(target);
            const targetStatsAfterEnsure = lstat(target);
            if (owner && targetStatsAfterEnsure?.uid === backendOwnerUid()) {
                fs.chmodSync(target, 0o700);
            }
        } else if (owner) {
            const targetStatsAfterCopy = lstat(target);
            if (targetStatsAfterCopy && !targetStatsAfterCopy.isSymbolicLink() && targetStatsAfterCopy.uid === backendOwnerUid()) {
                fs.chmodSync(target, targetStatsAfterCopy.mode & 0o7700);
            }
        }
        // A missing file target is fine: the CLI creates it through the link on first write.
        fs.symlinkSync(target, linkPath);
        return false;
    }

    function resolveEntry(root: string, entry: string): string {
        const resolvedRoot = path.resolve(root);
        const resolvedEntry = path.resolve(resolvedRoot, entry);
        if (!resolvedEntry.startsWith(`${resolvedRoot}${path.sep}`)) {
            throw new Error(`Refusing a persistent agent HOME entry outside ${resolvedRoot}.`);
        }
        return resolvedEntry;
    }

    function tryChown(directory: string, owner: QaapTenantPersistentHomeOwner, chown: QaapTenantPersistentHomeChown): void {
        const stats = lstat(directory);
        if (!stats || stats.isSymbolicLink()) {
            throw new Error(`Refusing to change ownership of a missing or symbolic-link directory: ${directory}`);
        }
        if (stats.uid === owner.uid && stats.gid === owner.gid) {
            return;
        }
        try {
            chown(directory, owner.uid, owner.gid);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EPERM') {
                throw error;
            }
            // Rootless container backends have SETUID/SETGID but not CAP_CHOWN. The caller grants
            // the agent an ACL after linking, while the container owner can still chmod this tree.
        }
    }

    function backendOwnerUid(): number {
        return typeof process.getuid === 'function' ? process.getuid() : 0;
    }

    function lstat(entry: string): fs.Stats | undefined {
        try {
            return fs.lstatSync(entry);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return undefined;
            }
            throw error;
        }
    }
}
