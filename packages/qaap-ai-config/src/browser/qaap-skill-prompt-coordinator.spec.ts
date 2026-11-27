// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { BasePromptFragment, PromptFragment, PromptService } from '@theia/ai-core/lib/common/prompt-service';
import { QaapSkillPromptCoordinator } from './qaap-skill-prompt-coordinator';

describe('QaapSkillPromptCoordinator', () => {

    function createCoordinator(
        skills: Array<{ name: string; description: string }>,
        existingCommands: PromptFragment[] = [],
    ): {
        coordinator: QaapSkillPromptCoordinator;
        added: BasePromptFragment[];
        removed: string[];
    } {
        const added: BasePromptFragment[] = [];
        const removed: string[] = [];
        const promptService: Partial<PromptService> = {
            getCommands: () => existingCommands,
            addBuiltInPromptFragment: (fragment: BasePromptFragment) => {
                added.push(fragment);
                if (fragment.isCommand && fragment.commandName) {
                    existingCommands.push(fragment);
                }
            },
            removePromptFragment: (id: string) => {
                removed.push(id);
            },
        };
        const skillService = {
            ready: Promise.resolve(),
            getSkills: () => skills,
            onSkillsChanged: () => ({ dispose: () => undefined }),
        };
        const coordinator = new QaapSkillPromptCoordinator();
        Object.assign(coordinator, { promptService, skillService });
        return { coordinator, added, removed };
    }

    it('registers unique skills as slash commands', () => {
        const { coordinator, added } = createCoordinator([
            { name: 'deploy', description: 'Deploy the app' },
        ]);
        (coordinator as unknown as { updateSkillCommands(): void }).updateSkillCommands();
        expect(added).to.deep.equal([{
            id: 'skill-command-deploy',
            template: 'Load the skill deploy using ~{getSkillFileContent}.',
            isCommand: true,
            commandName: 'deploy',
            commandDescription: 'Deploy the app',
        }]);
    });

    it('omits duplicate commandName when another fragment already claims the slash command', () => {
        const { coordinator, added } = createCoordinator(
            [
                { name: 'review', description: 'Workspace review skill' },
                { name: 'triage', description: 'Triage issues' },
            ],
            [
                {
                    id: 'claude-code-slash-review',
                    template: '/review',
                    isCommand: true,
                    commandName: 'review',
                    commandDescription: 'Request code review',
                },
            ],
        );
        (coordinator as unknown as { updateSkillCommands(): void }).updateSkillCommands();
        expect(added).to.deep.equal([
            {
                id: 'skill-command-review',
                template: 'Load the skill review using ~{getSkillFileContent}.',
                description: 'Workspace review skill',
            },
            {
                id: 'skill-command-triage',
                template: 'Load the skill triage using ~{getSkillFileContent}.',
                isCommand: true,
                commandName: 'triage',
                commandDescription: 'Triage issues',
            },
        ]);
    });

    it('re-evaluates collisions when another command registers or unregisters later', () => {
        const existingCommands: PromptFragment[] = [];
        const { coordinator, added } = createCoordinator(
            [{ name: 'review', description: 'Workspace review skill' }],
            existingCommands,
        );
        const sync = (): void => (coordinator as unknown as { updateSkillCommands(): void }).updateSkillCommands();

        // Initially no collision: skill claims /review.
        sync();
        expect(added.at(-1)?.isCommand).to.equal(true);
        expect(added.at(-1)?.commandName).to.equal('review');

        // Another fragment later claims /review: skill demotes cleanly.
        existingCommands.push({
            id: 'claude-code-slash-review',
            template: '/review',
            isCommand: true,
            commandName: 'review',
        });
        sync();
        expect(added.at(-1)?.isCommand).to.equal(undefined);
        expect(added.at(-1)?.commandName).to.equal(undefined);

        // If the colliding command is removed, the skill reclaims /review.
        existingCommands.length = 0;
        sync();
        expect(added.at(-1)?.isCommand).to.equal(true);
        expect(added.at(-1)?.commandName).to.equal('review');
    });
});
