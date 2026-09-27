// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { QaapGitReviewEndpoint } from './qaap-git-review-endpoint';

export default new ContainerModule(bind => {
    bind(QaapGitReviewEndpoint).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapGitReviewEndpoint);
});
