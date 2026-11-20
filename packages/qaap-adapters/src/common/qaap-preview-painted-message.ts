// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Posted (no payload) by the diagnostics script the dev-preview proxy injects into the previewed
 * page, to the embedding IDE, once the page shows content. The preview header's loading bar ends
 * there instead of at the frame's `load`, which a dev server's slow chunks can delay long after the
 * page is already visible.
 */
export const QAAP_PREVIEW_PAINTED_MESSAGE = 'qaap-preview-painted';
