// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { createHash } from 'crypto';
import { isQaapPreviewId } from '../common/qaap-preview-identity';
import { normalizeQaapPreviewBaseDomain } from './qaap-production-auth-readiness';

/**
 * Base domain of isolated preview hosts (`<hostLabel>.<domain>`), or undefined when that mode is off.
 * The main origin is also baked into the bridge loader and frame-ancestors policy, so the mode
 * requires an explicit public URL; deriving it from the preview Host would be unsafe.
 */
export function resolveQaapPreviewBaseDomain(env: NodeJS.ProcessEnv = process.env): string | undefined {
    if (!env.QAAP_OAUTH_PUBLIC_URL?.trim()) {
        return undefined;
    }
    return normalizeQaapPreviewBaseDomain(env.QAAP_PREVIEW_BASE_DOMAIN);
}

/**
 * DNS label of a preview's isolated host. The label IS the access capability: 128 bits derived
 * from the preview's secret access token, so it cannot be guessed from the (readable) preview id.
 * A cookie cannot carry the capability instead: the preview is framed by the Qaap app, a different
 * site, where browsers withhold SameSite cookies and Safari blocks third-party cookies outright.
 * Rotating the access token rotates the host.
 */
export function buildQaapPreviewHostLabel(previewId: string, accessToken: string): string {
    return createHash('sha256').update(`qaap-preview-host\0${previewId}\0${accessToken}`).digest('hex').slice(0, 32);
}

/** The host label of an isolated preview host (see {@link buildQaapPreviewHostLabel}), or undefined for any other host. */
export function parseQaapPreviewHostLabel(rawHost: string | undefined, baseDomain: string | undefined): string | undefined {
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
    const label = hostname.slice(0, -suffix.length);
    return isQaapPreviewId(label) ? label : undefined;
}
