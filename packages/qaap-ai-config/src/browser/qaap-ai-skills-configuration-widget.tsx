// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls, URI } from '@theia/core';
import { codicon, open } from '@theia/core/lib/browser';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import * as React from '@theia/core/shared/react';
import { Skill } from '@theia/ai-core/lib/common/skill';
import { PreferenceService } from '@theia/core/lib/common';
import { AISkillsConfigurationWidget } from '@theia/ai-ide/lib/browser/ai-configuration/skills-configuration-widget';
import { QaapSkillService } from './qaap-skill-service';
import { QAAP_DISABLED_SKILLS_PREF } from './qaap-skills-preferences';

export type QaapSkillSourceKind = 'system' | 'user' | 'project';

@injectable()
export class QaapAiSkillsConfigurationWidget extends AISkillsConfigurationWidget {

    @inject(QaapSkillService)
    protected readonly qaapSkillService: QaapSkillService;

    @inject(PreferenceService)
    protected readonly preferenceService: PreferenceService;

    @postConstruct()
    protected override init(): void {
        super.init();
        this.addClass('qaap-ai-skills-configuration');
        this.toDispose.push(this.preferenceService.onPreferenceChanged(event => {
            if (event.preferenceName === QAAP_DISABLED_SKILLS_PREF) {
                this.update();
            }
        }));
    }

    protected override loadSkills(): void {
        this.skills = this.qaapSkillService.getDiscoveredSkills().sort((a, b) => a.name.localeCompare(b.name));
    }

    protected override renderSkillsSection(): React.ReactNode {
        return (
            <div className="ai-skills-section qaap-ai-skills-section">
                <div className="qaap-ai-skills-section-header">
                    <h3 className="section-header">
                        {nls.localizeByDefault('Skills')}
                    </h3>
                    <p className="qaap-ai-skills-section-hint">
                        {nls.localize(
                            'qaap/aiConfiguration/skillsHint',
                            'Enable skills for the Work Hub composer slash menu. Each skill is a SKILL.md folder.',
                        )}
                    </p>
                </div>
                {this.skills.length === 0 ? (
                    <div className="ai-empty-state-content">
                        {nls.localize('theia/ai/ide/skillsConfiguration/noSkills', 'No skills available')}
                    </div>
                ) : (
                    <div className="qaap-ai-skills-list" role="list">
                        {this.skills.map(skill => this.renderSkillCard(skill))}
                    </div>
                )}
            </div>
        );
    }

    protected renderSkillCard(skill: Skill): React.ReactNode {
        const enabled = this.qaapSkillService.isSkillEnabled(skill.name);
        const source = this.resolveSkillSource(skill);
        return (
            <div
                key={skill.name}
                className={`qaap-ai-skill-card${enabled ? '' : ' theia-mod-disabled'}`}
                role="listitem"
            >
                <div className="qaap-ai-skill-card-icon" aria-hidden={true}>
                    <span className={codicon('symbol-misc')} />
                </div>
                <div className="qaap-ai-skill-card-body">
                    <div className="qaap-ai-skill-card-title-row">
                        <span className="qaap-ai-skill-card-name">{skill.name}</span>
                        <span className={`qaap-ai-skill-card-badge qaap-ai-skill-source-${source}`}>
                            {this.skillSourceLabel(source)}
                        </span>
                    </div>
                    <p className="qaap-ai-skill-card-description">{skill.description}</p>
                    <button
                        type="button"
                        className="qaap-ai-skill-card-open theia-button secondary"
                        onClick={() => this.openSkill(skill)}
                        title={nls.localizeByDefault('Open')}
                    >
                        {nls.localize('qaap/aiConfiguration/openSkillFile', 'Open SKILL.md')}
                    </button>
                </div>
                <button
                    type="button"
                    className={`qaap-ai-skill-toggle${enabled ? ' theia-mod-on' : ''}`}
                    role="switch"
                    aria-checked={enabled}
                    aria-label={nls.localize(
                        'qaap/aiConfiguration/toggleSkill',
                        'Toggle skill {0}',
                        skill.name,
                    )}
                    title={enabled
                        ? nls.localize('qaap/aiConfiguration/disableSkill', 'Disable skill')
                        : nls.localize('qaap/aiConfiguration/enableSkill', 'Enable skill')}
                    onClick={() => void this.toggleSkill(skill.name, !enabled)}
                />
            </div>
        );
    }

    protected async toggleSkill(skillName: string, enabled: boolean): Promise<void> {
        await this.qaapSkillService.setSkillEnabled(skillName, enabled);
        this.update();
    }

    protected resolveSkillSource(skill: Skill): QaapSkillSourceKind {
        const location = skill.location.replace(/\\/g, '/').toLowerCase();
        if (location.includes('/.qaap/users/') && location.includes('/skills/')) {
            return 'user';
        }
        if (
            location.includes('/qaap-system-skills/')
            || location.includes('/system-skills/')
            || location.includes('/opt/qaap/system-skills/')
        ) {
            return 'system';
        }
        return 'project';
    }

    protected skillSourceLabel(source: QaapSkillSourceKind): string {
        switch (source) {
            case 'system':
                return nls.localize('qaap/aiConfiguration/skillSourceSystem', 'System');
            case 'user':
                return nls.localize('qaap/aiConfiguration/skillSourceUser', 'User');
            default:
                return nls.localize('qaap/aiConfiguration/skillSourceProject', 'Project');
        }
    }

    protected override openSkill = (skill: Skill): void => {
        open(this.openerService, URI.fromFilePath(skill.location));
    };
}
