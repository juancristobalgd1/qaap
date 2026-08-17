// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { resolveEffectivePreviewUrl } from '@theia/qaap-adapters/lib/browser/qaap-preview-url-utils';
import { staticEntryPathFromDevCommand } from '../common/qaap-project-bootstrap-static';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';

/**
 * URL the transcript iframe should load. Identity claims are root-only; nested static demos
 * (`QAAP_STATIC_ENTRY=/docs/demo/`) and previously mounted app routes must be reapplied here
 * so Stop/Run, claim watch, and header Play cannot regress to backend `/` → "Not found".
 */
export function resolveTranscriptPreviewOpenUrl(options: {
    readonly candidateUrl: string;
    readonly project?: MobileProjectEntry;
    readonly bootstrap?: QaapProjectBootstrapService;
    readonly appliesToProject?: boolean;
}): string {
    const bootstrap = options.bootstrap;
    const applies = options.appliesToProject === true;
    // Bootstrap identity / QAAP_STATIC_ENTRY / remembered bootstrap URL belong to the
    // currently detected workspace. Never pin them onto another project's claim
    // (json-server must not inherit marked's `/docs/demo/`).
    const nestedEntry = applies
        ? staticEntryPathFromDevCommand(bootstrap?.descriptor?.devCommand)
        : undefined;
    return resolveEffectivePreviewUrl({
        candidateUrl: options.candidateUrl,
        identityUrl: applies ? bootstrap?.previewClaimUrl : undefined,
        nestedEntry,
        rememberedUrls: applies
            ? [options.project?.previewUrl, bootstrap?.previewUrl]
            : [options.project?.previewUrl],
    });
}
