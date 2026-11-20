// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { QaapGithubMcpCredentialResolver } from '@theia/qaap-shared-core/lib/node/qaap-github-mcp-credential-resolver';
import { QaapGithubMcpStatus, QaapGithubMcpStatusService } from '../common/qaap-github-mcp-status';

/** Answers the frontend with the credential status of the managed GitHub MCP server, never the token. */
@injectable()
export class QaapGithubMcpStatusServiceImpl implements QaapGithubMcpStatusService {

    @inject(QaapGithubMcpCredentialResolver)
    protected readonly credentialResolver: QaapGithubMcpCredentialResolver;

    async getStatus(): Promise<QaapGithubMcpStatus> {
        return QaapGithubMcpStatus.sanitize(await this.credentialResolver.describe());
    }
}
