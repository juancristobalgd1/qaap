// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as os from 'os';
import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';
import { SkillInstallBackendServiceImpl } from '@theia/ai-registry/lib/node/skill-install-backend-service';
import { resolveQaapTenantConfigRoot } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { resolveQaapWritableHome } from '@theia/qaap-cloud-workspace/lib/node/qaap-writable-home';

/**
 * Upstream installs registry skills under `~/.agents/skills` and creates it as soon as a client
 * connects. In the rootless production backend `/home/theia` is read-only, so that `mkdir` fails;
 * there the skills live under the persistent, writable tenant config root instead.
 */
@injectable()
export class QaapSkillInstallBackendServiceImpl extends SkillInstallBackendServiceImpl {

    protected override skillsRoot(): string {
        return path.join(resolveQaapWritableHome(os.homedir(), resolveQaapTenantConfigRoot()), '.agents', 'skills');
    }
}
