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

    /** Tracks whether each registered skill currently holds its slash command name or was demoted due to collision. */
    protected readonly registeredSkillAsCommand = new Map<string, boolean>();
    protected syncingSkillCommands = false;

    override async onStart(): Promise<void> {
        void this.skillService.ready.then(() => this.updateSkillCommands());
        this.skillService.onSkillsChanged(() => this.updateSkillCommands());
        this.promptService.onPromptsChange?.(() => {
            if (!this.syncingSkillCommands && this.registeredSkillCommands.size > 0) {
                this.updateSkillCommands();
            }
        });
    }

    /**
     * Avoid duplicate slash-command collisions (e.g. a `review` skill colliding with the
     * built-in `claude-code-slash-review` command). When another fragment already owns the
     * slash command name, keep the skill fragment registered by ID without re-claiming the
     * command name, and re-evaluate when prompts change.
     */
    protected override updateSkillCommands(): void {
        if (this.syncingSkillCommands) {
            return;
        }
        this.syncingSkillCommands = true;
        try {
            const currentSkills = this.skillService.getSkills();
            const currentSkillNames = new Set(currentSkills.map(skill => skill.name));

            for (const name of this.registeredSkillCommands) {
                if (!currentSkillNames.has(name)) {
                    this.promptService.removePromptFragment(`skill-command-${name}`);
                    this.registeredSkillCommands.delete(name);
                    this.registeredSkillAsCommand.delete(name);
                }
            }

            for (const skill of currentSkills) {
                const fragmentId = `skill-command-${skill.name}`;
                const shouldBeCommand = !this.isCommandNameClaimedByOtherFragment(skill.name, fragmentId);
                if (
                    this.registeredSkillCommands.has(skill.name)
                    && this.registeredSkillAsCommand.get(skill.name) === shouldBeCommand
                ) {
                    continue;
                }
                this.promptService.addBuiltInPromptFragment(shouldBeCommand
                    ? {
                        id: fragmentId,
                        template: `Load the skill ${skill.name} using ~{getSkillFileContent}.`,
                        isCommand: true,
                        commandName: skill.name,
                        commandDescription: skill.description,
                    }
                    : {
                        id: fragmentId,
                        template: `Load the skill ${skill.name} using ~{getSkillFileContent}.`,
                        description: skill.description,
                    });
                this.registeredSkillCommands.add(skill.name);
                this.registeredSkillAsCommand.set(skill.name, shouldBeCommand);
            }
        } finally {
            this.syncingSkillCommands = false;
        }
    }

    protected isCommandNameClaimedByOtherFragment(commandName: string, selfFragmentId: string): boolean {
        return this.promptService.getCommands().some(
            fragment => fragment.id !== selfFragmentId && fragment.commandName === commandName,
        );
    }
}
