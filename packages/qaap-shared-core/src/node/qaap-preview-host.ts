// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { isQaapPreviewId } from '../common/qaap-preview-identity';
import { normalizeQaapPreviewBaseDomain } from './qaap-production-auth-readiness';

/**
 * Base domain of isolated preview hosts (`<previewId>.<domain>`), or undefined when that mode is off.
 * The main origin is also baked into the bridge loader and frame-ancestors policy, so the mode
 * requires an explicit public URL; deriving it from the preview Host would be unsafe.
 */
export function resolveQaapPreviewBaseDomain(env: NodeJS.ProcessEnv = process.env): string | undefined {
    if (!env.QAAP_OAUTH_PUBLIC_URL?.trim()) {
        return undefined;
    }
    return normalizeQaapPreviewBaseDomain(env.QAAP_PREVIEW_BASE_DOMAIN);
}

/** The preview id an isolated preview host names, or undefined for any other host. */
export function parseQaapPreviewIdFromHost(rawHost: string | undefined, baseDomain: string | undefined): string | undefined {
    if (!baseDomain || !rawHost) {
        return undefined;
    }
    let hostname: string;
    try {
        hostname = new URL(`http://${rawHost}`).hostname.toLowerCase();
    } catch {
        return undefined;
    }
    const suffix = `.${baseDomain.replace(/:\d+$/, '')}`;
    if (!hostname.endsWith(suffix)) {
        return undefined;
    }
    const previewId = hostname.slice(0, -suffix.length);
    return isQaapPreviewId(previewId) ? previewId : undefined;
}
