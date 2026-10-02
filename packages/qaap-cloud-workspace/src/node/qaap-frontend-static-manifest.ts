// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';
import { BackendApplicationPath } from '@theia/core/lib/node';

export interface QaapFrontendStaticClassification {
    /** The control plane can serve this request from its own `lib/frontend`. */
    readonly static: boolean;
    /** A top-level document load (`/`, `/index.html`, `/secondary-window.html`). */
    readonly isNavigation: boolean;
}

/**
 * Path prefixes that always belong to the tenant backend, even if a same-named file happened to
 * exist in `lib/frontend`. Segment prefixes match `/x` and `/x/...`; loose prefixes match any path
 * starting with them (`/files`, `/plugins`, `/vscode-...`).
 */
const TENANT_SEGMENT_PREFIXES = ['/socket.io', '/services', '/qaap', '/qaap-dev', '/qaap-preview', '/hostedPlugin', '/webview', '/mini-browser'];
const TENANT_LOOSE_PREFIXES = ['/file', '/plugin', '/vscode'];
const NAVIGATION_PATHS = new Set(['/', '/index.html', '/secondary-window.html']);
const NOT_STATIC: QaapFrontendStaticClassification = { static: false, isNavigation: false };

/**
 * The browser frontend (`index.html`, `bundle.js`, hashed chunks, media, `/legal/*`) is generated at
 * build time and identical in every process running the same build, so the control plane can serve
 * it while a cold tenant backend starts. This classifier only says "static" for safe GET/HEAD
 * requests whose decoded path names a real file of the control plane's `lib/frontend`; everything
 * else (RPC, plugins, webviews, files, previews, unknown paths) stays with the tenant.
 */
@injectable()
export class QaapFrontendStaticManifest {

    protected files: ReadonlySet<string> | undefined;

    classify(method: string | undefined, rawUrl: string | undefined): QaapFrontendStaticClassification {
        if (method !== 'GET' && method !== 'HEAD') {
            return NOT_STATIC;
        }
        const rawPath = (rawUrl ?? '/').split('?', 1)[0];
        // Encoded separators could make the static server and this check disagree on the file.
        if (/%2f|%5c/i.test(rawPath)) {
            return NOT_STATIC;
        }
        let pathname: string;
        try {
            pathname = decodeURIComponent(rawPath);
        } catch {
            return NOT_STATIC;
        }
        if (!pathname.startsWith('/') || pathname.includes('..') || pathname.includes('\\') || pathname.includes('\0')) {
            return NOT_STATIC;
        }
        if (TENANT_SEGMENT_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))
            || TENANT_LOOSE_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
            return NOT_STATIC;
        }
        const files = this.getFiles();
        // `/` is served as index.html; only claim it when the control plane really has one.
        const known = pathname === '/' ? files.has('/index.html') : files.has(pathname);
        return known ? { static: true, isNavigation: NAVIGATION_PATHS.has(pathname) } : NOT_STATIC;
    }

    protected getFiles(): ReadonlySet<string> {
        if (!this.files) {
            this.files = this.scan(this.frontendDir());
        }
        return this.files;
    }

    /** Same directory `QaapFrontendStaticServer` serves (`@theia/qaap-product`). */
    protected frontendDir(): string {
        return path.join(BackendApplicationPath, 'lib', 'frontend');
    }

    /** One synchronous walk on first use; the build output does not change while the process runs. */
    protected scan(root: string): Set<string> {
        const files = new Set<string>();
        const pending = [''];
        while (pending.length > 0) {
            const relative = pending.pop()!;
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true });
            } catch {
                continue;
            }
            for (const entry of entries) {
                const child = relative ? `${relative}/${entry.name}` : entry.name;
                if (entry.isDirectory()) {
                    pending.push(child);
                } else if (entry.isFile()) {
                    files.add(`/${child}`);
                }
            }
        }
        return files;
    }
}
