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

export interface QaapTenantPersistentHomeLinkResult {
    readonly changedEntries: string[];
    readonly complete: boolean;
}

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
        return linkWithStatus(home, persistentHome, owner, chown).changedEntries;
    }

    export function linkWithStatus(
        home: string,
        persistentHome: string,
        owner?: QaapTenantPersistentHomeOwner,
        chown: QaapTenantPersistentHomeChown = fs.chownSync
    ): QaapTenantPersistentHomeLinkResult {
        ensureDirectory(home, owner, chown);
        ensureDirectory(persistentHome);
        // A rootless backend without CAP_FOWNER can only chmod what it owns; storage the agent
        // already owns is left alone (the agent can use it as is).
        if (owner && lstat(persistentHome)?.uid === backendOwnerUid()) {
            fs.chmodSync(persistentHome, 0o1700);
        }
        const homeDevice = lstat(home)?.dev;
        if (homeDevice === undefined) {
            throw new Error(`Cannot determine the device of persistent agent HOME: ${home}`);
        }
        const changedEntries: string[] = [];
        let complete = true;
        for (const entry of QAAP_PERSISTENT_HOME_DIRECTORIES) {
            const result = linkEntry(home, persistentHome, entry, true, homeDevice, owner, chown);
            if (result.changed) {
                changedEntries.push(resolveEntry(persistentHome, entry));
            }
            complete = complete && result.complete;
        }
        for (const entry of QAAP_PERSISTENT_HOME_FILES) {
            const result = linkEntry(home, persistentHome, entry, false, homeDevice, owner, chown);
            if (result.changed) {
                changedEntries.push(resolveEntry(persistentHome, entry));
            }
            complete = complete && result.complete;
        }
        return { changedEntries, complete };
    }

    export async function linkWithStatusAsync(
        home: string,
        persistentHome: string,
        owner?: QaapTenantPersistentHomeOwner,
    ): Promise<QaapTenantPersistentHomeLinkResult> {
        await ensureDirectoryAsync(home, owner);
        await ensureDirectoryAsync(persistentHome);
        const persistentStats = await lstatAsync(persistentHome);
        if (owner && persistentStats?.uid === backendOwnerUid()) {
            await fs.promises.chmod(persistentHome, 0o1700);
        }
        const homeDevice = (await lstatAsync(home))?.dev;
        if (homeDevice === undefined) {
            throw new Error(`Cannot determine the device of persistent agent HOME: ${home}`);
        }
        const changedEntries: string[] = [];
        let complete = true;
        for (const entry of QAAP_PERSISTENT_HOME_DIRECTORIES) {
            const result = await linkEntryAsync(home, persistentHome, entry, true, homeDevice, owner);
            if (result.changed) {
                changedEntries.push(resolveEntry(persistentHome, entry));
            }
            complete = complete && result.complete;
        }
        for (const entry of QAAP_PERSISTENT_HOME_FILES) {
            const result = await linkEntryAsync(home, persistentHome, entry, false, homeDevice, owner);
            if (result.changed) {
                changedEntries.push(resolveEntry(persistentHome, entry));
            }
            complete = complete && result.complete;
        }
        return { changedEntries, complete };
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

    export async function ensureDirectoryAsync(
        directory: string,
        owner?: QaapTenantPersistentHomeOwner,
    ): Promise<void> {
        const resolved = path.resolve(directory);
        const root = path.parse(resolved).root;
        let current = root;
        for (const component of resolved.slice(root.length).split(path.sep).filter(Boolean)) {
            current = path.join(current, component);
            let stats = await lstatAsync(current);
            if (!stats) {
                try {
                    await fs.promises.mkdir(current, { mode: 0o700 });
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
                        throw error;
                    }
                }
                stats = await lstatAsync(current);
            }
            if (!stats || stats.isSymbolicLink() || !stats.isDirectory()) {
                throw new Error(`Refusing to use a non-directory or symlink in persistent agent HOME: ${current}`);
            }
        }
        if (!owner) {
            return;
        }
        try {
            await fs.promises.chown(resolved, owner.uid, owner.gid);
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== 'EPERM' && code !== 'EACCES') {
                throw error;
            }
        }
        const stats = await lstatAsync(resolved);
        if (!stats || stats.isSymbolicLink() || !stats.isDirectory()) {
            throw new Error(`Refusing to set permissions on a missing or symbolic-link directory: ${resolved}`);
        }
        const mode = stats.mode & 0o7777;
        const privateMode = (mode | 0o700) & ~0o077;
        if (privateMode !== mode && stats.uid === backendOwnerUid()) {
            await fs.promises.chmod(resolved, privateMode);
        }
    }

    function linkEntry(
        home: string,
        persistentHome: string,
        entry: string,
        directory: boolean,
        homeDevice: number,
        owner?: QaapTenantPersistentHomeOwner,
        chown: QaapTenantPersistentHomeChown = fs.chownSync
    ): { changed: boolean; complete: boolean } {
        const linkPath = resolveEntry(home, entry);
        const target = resolveEntry(persistentHome, entry);
        const currentState = lstatLinkTarget(linkPath);
        if (currentState.inaccessible) {
            // HOME may already be owned by the agent and mode 0700. Treat an entry that the
            // backend cannot inspect the same as an inaccessible persistent target and retry
            // preparation on a later request.
            return { changed: false, complete: false };
        }
        const current = currentState.stats;
        const targetState = lstatLinkTarget(target);
        if (targetState.inaccessible) {
            // The agent may own a private 0700 persistent HOME that this backend cannot search.
            // Keep tmpfs state untouched, or install the expected link when HOME has no entry.
            if (!current) {
                fs.symlinkSync(target, linkPath);
                return { changed: false, complete: true };
            }
            const alreadyLinked = current.isSymbolicLink() && fs.readlinkSync(linkPath) === target;
            return { changed: false, complete: alreadyLinked };
        }
        const targetStats = targetState.stats;
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
                return { changed: false, complete: true };
            }
            fs.unlinkSync(linkPath);
        } else if (current) {
            // Written into the tmpfs before the link existed: this is the newest state, keep it.
            // Do not bring symlinks or mounted subtrees from the volatile HOME into persistent storage.
            if (current.dev !== homeDevice) {
                return { changed: false, complete: false };
            }
            fs.cpSync(linkPath, target, {
                recursive: true,
                force: true,
                dereference: false,
                filter: source => {
                    const stats = fs.lstatSync(source);
                    return !stats.isSymbolicLink() && stats.dev === homeDevice;
                }
            });
            const sourceRemoved = removeEntryWithinDevice(linkPath, homeDevice);
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
            if (!sourceRemoved) {
                return { changed: true, complete: false };
            }
            fs.symlinkSync(target, linkPath);
            return { changed: true, complete: true };
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
        return { changed: false, complete: true };
    }

    async function linkEntryAsync(
        home: string,
        persistentHome: string,
        entry: string,
        directory: boolean,
        homeDevice: number,
        owner?: QaapTenantPersistentHomeOwner,
    ): Promise<{ changed: boolean; complete: boolean }> {
        const linkPath = resolveEntry(home, entry);
        const target = resolveEntry(persistentHome, entry);
        const currentState = await lstatLinkTargetAsync(linkPath);
        if (currentState.inaccessible) {
            return { changed: false, complete: false };
        }
        const current = currentState.stats;
        const targetState = await lstatLinkTargetAsync(target);
        if (targetState.inaccessible) {
            if (!current) {
                await fs.promises.symlink(target, linkPath);
                return { changed: false, complete: true };
            }
            const alreadyLinked = current.isSymbolicLink() && await fs.promises.readlink(linkPath) === target;
            return { changed: false, complete: alreadyLinked };
        }
        const targetStats = targetState.stats;
        if (targetStats?.isSymbolicLink()) {
            throw new Error(`Refusing a symlink in persistent agent HOME: ${target}`);
        }
        if (current?.isSymbolicLink()) {
            if (await fs.promises.readlink(linkPath) === target) {
                if (directory) {
                    if (targetStats && !targetStats.isDirectory()) {
                        throw new Error(`Persistent agent HOME entry is not a directory: ${target}`);
                    }
                    await ensureDirectoryAsync(target);
                    if (owner && targetStats?.uid === backendOwnerUid()) {
                        await fs.promises.chmod(target, 0o700);
                    }
                } else if (targetStats && owner && targetStats.uid === backendOwnerUid()) {
                    await fs.promises.chmod(target, targetStats.mode & 0o7700);
                }
                return { changed: false, complete: true };
            }
            await fs.promises.unlink(linkPath);
        } else if (current) {
            if (current.dev !== homeDevice) {
                return { changed: false, complete: false };
            }
            await fs.promises.cp(linkPath, target, {
                recursive: true,
                force: true,
                dereference: false,
                filter: async source => {
                    const stats = await lstatAsync(source);
                    return !!stats && !stats.isSymbolicLink() && stats.dev === homeDevice;
                },
            });
            const sourceRemoved = await removeEntryWithinDeviceAsync(linkPath, homeDevice);
            if (directory) {
                await ensureDirectoryAsync(target);
                const targetStatsAfterCopy = await lstatAsync(target);
                if (owner && targetStatsAfterCopy?.uid === backendOwnerUid()) {
                    await fs.promises.chmod(target, 0o700);
                }
            } else if (owner) {
                const targetStatsAfterCopy = await lstatAsync(target);
                if (targetStatsAfterCopy && !targetStatsAfterCopy.isSymbolicLink() && targetStatsAfterCopy.uid === backendOwnerUid()) {
                    await fs.promises.chmod(target, targetStatsAfterCopy.mode & 0o7700);
                }
            }
            if (!sourceRemoved) {
                return { changed: true, complete: false };
            }
            await fs.promises.symlink(target, linkPath);
            return { changed: true, complete: true };
        }
        if (directory) {
            await ensureDirectoryAsync(target);
            const targetStatsAfterEnsure = await lstatAsync(target);
            if (owner && targetStatsAfterEnsure?.uid === backendOwnerUid()) {
                await fs.promises.chmod(target, 0o700);
            }
        } else if (owner) {
            const targetStatsAfterCopy = await lstatAsync(target);
            if (targetStatsAfterCopy && !targetStatsAfterCopy.isSymbolicLink() && targetStatsAfterCopy.uid === backendOwnerUid()) {
                await fs.promises.chmod(target, targetStatsAfterCopy.mode & 0o7700);
            }
        }
        await fs.promises.symlink(target, linkPath);
        return { changed: false, complete: true };
    }

    function resolveEntry(root: string, entry: string): string {
        const resolvedRoot = path.resolve(root);
        const resolvedEntry = path.resolve(resolvedRoot, entry);
        if (!resolvedEntry.startsWith(`${resolvedRoot}${path.sep}`)) {
            throw new Error(`Refusing a persistent agent HOME entry outside ${resolvedRoot}.`);
        }
        return resolvedEntry;
    }

    function lstatLinkTarget(entry: string): { stats?: fs.Stats; inaccessible: boolean } {
        try {
            return { stats: fs.lstatSync(entry), inaccessible: false };
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'ENOENT') {
                return { inaccessible: false };
            }
            if (code === 'EACCES') {
                return { inaccessible: true };
            }
            throw error;
        }
    }

    async function lstatLinkTargetAsync(entry: string): Promise<{ stats?: fs.Stats; inaccessible: boolean }> {
        try {
            return { stats: await fs.promises.lstat(entry), inaccessible: false };
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'ENOENT') {
                return { inaccessible: false };
            }
            if (code === 'EACCES') {
                return { inaccessible: true };
            }
            throw error;
        }
    }

    function removeEntryWithinDevice(entry: string, device: number): boolean {
        const stats = lstat(entry);
        if (!stats) {
            return true;
        }
        if (stats.dev !== device) {
            return false;
        }
        if (stats.isSymbolicLink() || !stats.isDirectory()) {
            fs.unlinkSync(entry);
            return true;
        }
        let complete = true;
        for (const name of fs.readdirSync(entry)) {
            if (!removeEntryWithinDevice(path.join(entry, name), device)) {
                complete = false;
            }
        }
        if (!complete) {
            return false;
        }
        try {
            fs.rmdirSync(entry);
            return true;
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'EBUSY' || code === 'ENOTEMPTY') {
                return false;
            }
            throw error;
        }
    }

    async function removeEntryWithinDeviceAsync(entry: string, device: number): Promise<boolean> {
        const stats = await lstatAsync(entry);
        if (!stats) {
            return true;
        }
        if (stats.dev !== device) {
            return false;
        }
        if (stats.isSymbolicLink() || !stats.isDirectory()) {
            await fs.promises.unlink(entry);
            return true;
        }
        let complete = true;
        for (const name of await fs.promises.readdir(entry)) {
            if (!await removeEntryWithinDeviceAsync(path.join(entry, name), device)) {
                complete = false;
            }
        }
        if (!complete) {
            return false;
        }
        try {
            await fs.promises.rmdir(entry);
            return true;
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'EBUSY' || code === 'ENOTEMPTY') {
                return false;
            }
            throw error;
        }
    }

    async function lstatAsync(entry: string): Promise<fs.Stats | undefined> {
        try {
            return await fs.promises.lstat(entry);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return undefined;
            }
            throw error;
        }
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
