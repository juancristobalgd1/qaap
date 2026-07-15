// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { SkillPromptCoordinator } from '@theia/ai-core/lib/browser/skill-prompt-coordinator';

/**
 * Upstream {@link SkillPromptCoordinator} awaits {@link SkillService.ready} in `onStart`, which
 * blocks the entire frontend contribution chain until the first skills directory scan finishes.
 * On hosted VPS deployments that scan can take tens of seconds and leaves the UI on the splash/logo.
 */
@injectable()
export class QaapSkillPromptCoordinator extends SkillPromptCoordinator {

    override async onStart(): Promise<void> {
        void this.skillService.ready.then(() => this.updateSkillCommands());
        this.skillService.onSkillsChanged(() => this.updateSkillCommands());
    }
}
