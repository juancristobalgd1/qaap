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
];

/** Optional owner applied to created entries when the backend runs as root and drops agents to a uid. */
export interface QaapTenantPersistentHomeOwner {
    readonly uid: number;
    readonly gid: number;
}

/**
 * Links the credential entries of a volatile tenant HOME to a directory on the tenant's private,
 * disk-backed storage. Existing entries in HOME (written before the link existed) are moved over.
 */
export namespace QaapTenantPersistentHome {

    export function link(home: string, persistentHome: string, owner?: QaapTenantPersistentHomeOwner): void {
        ensureDirectory(home, owner);
        ensureDirectory(persistentHome, owner);
        for (const entry of QAAP_PERSISTENT_HOME_DIRECTORIES) {
            linkEntry(home, persistentHome, entry, true, owner);
        }
        for (const entry of QAAP_PERSISTENT_HOME_FILES) {
            linkEntry(home, persistentHome, entry, false, owner);
        }
    }

    function linkEntry(home: string, persistentHome: string, entry: string, directory: boolean, owner?: QaapTenantPersistentHomeOwner): void {
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
            applyOwner(target, owner, true);
        }
        if (directory) {
            ensureDirectory(target, owner);
        }
        // A missing file target is fine: the CLI creates it through the link on first write.
        fs.symlinkSync(target, linkPath);
        if (owner) {
            fs.lchownSync(linkPath, owner.uid, owner.gid);
        }
    }

    function ensureDirectory(directory: string, owner?: QaapTenantPersistentHomeOwner): void {
        if (lstat(directory)) {
            return;
        }
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        applyOwner(directory, owner, false);
    }

    function applyOwner(entry: string, owner: QaapTenantPersistentHomeOwner | undefined, recursive: boolean): void {
        if (!owner) {
            return;
        }
        fs.chownSync(entry, owner.uid, owner.gid);
        if (recursive && fs.statSync(entry).isDirectory()) {
            for (const child of fs.readdirSync(entry)) {
                applyOwner(path.join(entry, child), owner, true);
            }
        }
    }

    function lstat(entry: string): fs.Stats | undefined {
        try {
            return fs.lstatSync(entry);
        } catch {
            return undefined;
        }
    }
}
