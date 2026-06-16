// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { URI } from '@theia/core';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { parseSkillFile, type Skill } from '@theia/ai-core/lib/common/skill';
import type { SkillService } from '@theia/ai-core/lib/browser/skill-service';

/** Same kebab-case names as {@link SkillService} / Cursor skills folders. */
const COMPOSER_SKILL_SLASH_PATTERN = /(?:^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\s+([\s\S]*))?$/;

export interface ComposerSkillSubmitDeps {
    readonly skillService: SkillService;
    readonly fileService: FileService;
}

async function readSkillBody(skill: Skill, fileService: FileService): Promise<string | undefined> {
    try {
        const skillFileUri = URI.fromFilePath(skill.location);
        const fileContent = await fileService.read(skillFileUri);
        return parseSkillFile(fileContent.value).content.trim();
    } catch {
        return undefined;
    }
}

/**
 * Expands a trailing `/skill-name` slash token into inline skill instructions for VPS/CLI agents.
 * Desktop chat resolves slash commands via {@link ChatRequestParser}; mobile composer submits plain text.
 */
export async function expandComposerSkillSlashCommands(
    draft: string,
    deps: ComposerSkillSubmitDeps,
): Promise<string> {
    const trimmedEnd = draft.trimEnd();
    const match = trimmedEnd.match(COMPOSER_SKILL_SLASH_PATTERN);
    if (!match) {
        return draft;
    }
    const skillName = match[1];
    const skill = deps.skillService.getSkill(skillName);
    if (!skill) {
        return draft;
    }
    const skillBody = await readSkillBody(skill, deps.fileService);
    if (!skillBody) {
        return draft;
    }

    const slashToken = `/${skillName}`;
    const slashIndex = trimmedEnd.lastIndexOf(slashToken);
    if (slashIndex < 0) {
        return draft;
    }
    const prefix = trimmedEnd.slice(0, slashIndex).trim();
    const trailingUserText = match[2]?.trim() ?? '';

    const skillBlock = [
        `Follow the "${skillName}" skill. Skill instructions:`,
        '',
        skillBody,
    ].join('\n');

    const segments = [prefix, skillBlock, trailingUserText].filter(segment => segment.length > 0);
    return segments.join('\n\n');
}
