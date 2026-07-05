// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import path = require('path');
import express = require('@theia/core/shared/express');
import { FileUri } from '@theia/core/lib/node';
import { inject, injectable } from '@theia/core/shared/inversify';
import { NodeFileUploadService } from '@theia/filesystem/lib/node/upload/node-file-upload-service';
import { QaapGithubAuthGuard } from '@theia/qaap-mobile-shell/lib/node/qaap-github-auth-guard';

/**
 * Confines HTTP file uploads to the authenticated user's workspace tree.
 *
 * The upstream service only rejects relative traversal (`normalize !== resolve`),
 * which passes any absolute path, and performs no authentication — on the shared
 * multi-tenant backend that allows an arbitrary caller to write anywhere the
 * backend process can. This subclass requires a session and asserts the resolved
 * target sits under the caller's own workspace root before delegating to the
 * upstream move; skip-auth (single-user/local dev) keeps the upstream behaviour.
 */
@injectable()
export class QaapNodeFileUploadService extends NodeFileUploadService {

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    protected override async handleFileUpload(request: express.Request, response: express.Response): Promise<void> {
        const fields = request.body;
        if (!request.file || typeof fields !== 'object' || typeof fields.uri !== 'string') {
            response.sendStatus(400); // bad request
            return;
        }
        const target = path.resolve(FileUri.fsPath(fields.uri));
        // Sends 401 when unauthenticated and 403 when the target escapes the owner's
        // workspace root; returns true (no response written) under skip-auth dev mode.
        if (!this.auth.assertWorkspacePathOwned(request, response, target, 'workspace_path')) {
            return;
        }
        return super.handleFileUpload(request, response);
    }
}
