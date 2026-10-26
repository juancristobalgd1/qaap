// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import URI from '@theia/core/lib/common/uri';

/**
 * True when the project bootstrap is already starting or installing the root a thread previews.
 * A visual-verification request in that window would call the preview bootstrap again, which
 * refreshes the root and releases the run that is still booting.
 *
 * @param phase the bootstrap phase from its state snapshot
 * @param bootingRoot the root of the bootstrap's current descriptor, as a URI string
 * @param previewRoot the filesystem root the thread previews from
 */
export function isPreviewRootBootingInBootstrap(phase: string | undefined, bootingRoot: string | undefined, previewRoot: string | undefined): boolean {
    if (phase !== 'starting' && phase !== 'installing') {
        return false;
    }
    if (!bootingRoot || !previewRoot) {
        return false;
    }
    return bootingRoot === URI.fromFilePath(previewRoot).toString();
}
