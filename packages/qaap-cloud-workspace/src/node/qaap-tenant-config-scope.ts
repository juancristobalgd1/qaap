// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as path from 'path';
import URI from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/common/file-uri';
import {
    resolveQaapTenantConfigRoot as resolveSharedQaapTenantConfigRoot,
    resolveQaapTenantUserRoot as resolveSharedQaapTenantUserRoot,
} from '@theia/qaap-adapters/lib/common/qaap-user-isolation';

let sharedTheiaConfigDir: string | undefined;

/** Override used by deployments that mount tenant configuration outside the default home. */
export function resolveQaapTenantConfigRoot(): string {
    return resolveSharedQaapTenantConfigRoot();
}

/** The Theia user-storage directory for one authenticated tenant. */
export function resolveQaapTenantConfigDir(ownerLogin: string): string {
    const owner = ownerLogin.trim();
    if (!owner) {
        throw new Error('Cannot resolve a tenant config directory without an owner login.');
    }
    return path.join(resolveQaapTenantUserRoot(owner), 'theia');
}

/** Root for all persisted, browser-visible state owned by one tenant. */
export function resolveQaapTenantUserRoot(ownerLogin: string): string {
    const owner = ownerLogin.trim();
    if (!owner) {
        throw new Error('Cannot resolve a tenant data directory without an owner login.');
    }
    return resolveSharedQaapTenantUserRoot(owner);
}

/** True for paths lexically located in the tenant configuration tree. */
export function isQaapTenantConfigPath(fsPath: string): boolean {
    const root = path.resolve(resolveQaapTenantConfigRoot());
    const target = path.resolve(fsPath);
    const relative = path.relative(root, target);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** Remember the process-wide Theia config directory so direct file access cannot bypass tenant storage. */
export function rememberQaapSharedTheiaConfigDir(uri: string): void {
    sharedTheiaConfigDir = path.resolve(FileUri.fsPath(new URI(uri)));
}

/** True for the original process-wide Theia config directory and its descendants. */
export function isQaapSharedTheiaConfigPath(fsPath: string): boolean {
    if (!sharedTheiaConfigDir) {
        return false;
    }
    const relative = path.relative(sharedTheiaConfigDir, path.resolve(fsPath));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
