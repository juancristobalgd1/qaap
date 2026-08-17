// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Static-site support for the project bootstrap pipeline.
 *
 * Re-exported from the common module so the browser and the Node backend share the same
 * zero-dependency static server command.
 */

export {
    STATIC_INDEX_FILE,
    STATIC_INSTALL_COMMAND,
    STATIC_ROOT_CANDIDATE_DIRS,
    STATIC_SERVER_SCRIPT,
    buildStaticIndexHtml,
    buildStaticPackageJson,
    buildStaticServeCommand,
    nestedStaticUrlFallbacks,
    shouldServeNestedStaticFromWorkspaceRoot,
    staticEntryPathFromDevCommand,
} from '../common/qaap-project-bootstrap-static';
