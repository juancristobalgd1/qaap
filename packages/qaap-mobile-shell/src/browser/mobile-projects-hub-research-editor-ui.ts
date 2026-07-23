// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { MessageService } from '@theia/core/lib/common/message-service';
import { createResearchGoal } from '../common/qaap-research-client';
import type { QaapCreateResearchGoalBody } from '../common/qaap-research-api';
import { createFormFieldLabel, wireFormFieldLabel } from './qaap-mobile-form-ui';
import { MobileSnackbar } from './mobile-snackbar';
import type { MobileProjectsHubView, MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsService } from './mobile-projects-service';

/** Panel surface for the minimal research create/start sheet. */
export interface MobileProjectsHubResearchEditorHost {
    projects: MobileProjectEntry[];
    visible: boolean;
    hubView: MobileProjectsHubView;
    researchSheet: HTMLElement | undefined;
    researchInteractionLock: boolean;
    projectsService: MobileProjectsService;
    messageService: MessageService | undefined;

    refreshResearchGoals(force?: boolean): Promise<void>;
    renderList(): void;
}

/** Minimal sheet to create a research goal and start it on the VPS backend. */
export class MobileProjectsHubResearchEditorUi {

    protected escapeListener: ((ev: KeyboardEvent) => void) | undefined;
    protected restoreFocusTo: HTMLElement | undefined;

    constructor(protected readonly host: MobileProjectsHubResearchEditorHost) { }

    resolveDefaultResearchCwd(): string {
        const current = this.host.projects.find(project => project.isCurrent);
        const cwd = current ? this.host.projectsService.getProjectCwd(current) : undefined;
        if (cwd) {
            return cwd;
        }
        for (const project of this.host.projects) {
            const candidate = this.host.projectsService.getProjectCwd(project);
            if (candidate) {
                return candidate;
            }
        }
        return '';
    }

    openResearchEditor(): void {
        this.closeResearchEditor();
        const previouslyFocused = document.activeElement;
        this.restoreFocusTo = previouslyFocused instanceof HTMLElement ? previouslyFocused : undefined;

        const sheet = document.createElement('div');
        sheet.className = 'theia-mobile-routine-sheet theia-mod-research-sheet';
        sheet.setAttribute('role', 'dialog');
        sheet.setAttribute('aria-modal', 'true');

        const backdrop = document.createElement('div');
        backdrop.className = 'theia-mobile-routine-sheet-backdrop';
        backdrop.addEventListener('click', () => this.closeResearchEditor());

        const panel = document.createElement('section');
        panel.className = 'theia-mobile-routine-sheet-panel q-sheet';
        panel.addEventListener('click', ev => ev.stopPropagation());
        panel.addEventListener('pointerdown', ev => ev.stopPropagation());

        const handle = document.createElement('div');
        handle.className = 'theia-mobile-routine-sheet-handle';
        handle.setAttribute('aria-hidden', 'true');

        const header = document.createElement('header');
        header.className = 'theia-mobile-routine-sheet-header';
        const heading = document.createElement('h2');
        heading.id = 'qaap-research-sheet-title';
        heading.textContent = nls.localize('qaap/mobileProjects/researchNew', 'New research goal');
        sheet.setAttribute('aria-labelledby', heading.id);

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'theia-mobile-routine-sheet-close q-icon-button';
        const closeLabel = nls.localize('qaap/mobileProjects/researchClose', 'Close');
        close.title = closeLabel;
        close.setAttribute('aria-label', closeLabel);
        const closeIcon = document.createElement('span');
        closeIcon.className = 'codicon codicon-close';
        closeIcon.setAttribute('aria-hidden', 'true');
        close.append(closeIcon);
        close.addEventListener('click', () => this.closeResearchEditor());
        header.append(heading, close);

        const form = document.createElement('div');
        form.className = 'theia-mobile-routine-sheet-form';

        const descriptionInput = document.createElement('textarea');
        descriptionInput.className = 'theia-mobile-routine-field theia-mod-textarea';
        descriptionInput.placeholder = nls.localize(
            'qaap/mobileProjects/researchDescriptionPlaceholder',
            'What should the researcher optimize?',
        );

        const cwdInput = document.createElement('input');
        cwdInput.type = 'text';
        cwdInput.className = 'theia-mobile-routine-field';
        cwdInput.placeholder = nls.localize(
            'qaap/mobileProjects/researchCwdPlaceholder',
            'Working directory (absolute path)',
        );
        cwdInput.value = this.resolveDefaultResearchCwd();

        const metricCommandInput = document.createElement('input');
        metricCommandInput.type = 'text';
        metricCommandInput.className = 'theia-mobile-routine-field';
        metricCommandInput.placeholder = nls.localize(
            'qaap/mobileProjects/researchMetricCommandPlaceholder',
            'Metric command (prints a number, e.g. echo 0.5)',
        );
        metricCommandInput.value = 'echo 0.5';

        const runCommandInput = document.createElement('input');
        runCommandInput.type = 'text';
        runCommandInput.className = 'theia-mobile-routine-field';
        runCommandInput.placeholder = nls.localize(
            'qaap/mobileProjects/researchRunCommandPlaceholder',
            'Optional long run command (hours on the VPS)',
        );

        const descriptionLabel = createFormFieldLabel(
            nls.localize('qaap/mobileProjects/researchDescription', 'Goal'),
            { id: 'qaap-research-field-description' },
        );
        const cwdLabel = createFormFieldLabel(
            nls.localize('qaap/mobileProjects/researchCwd', 'Repository'),
            { id: 'qaap-research-field-cwd' },
        );
        const metricLabel = createFormFieldLabel(
            nls.localize('qaap/mobileProjects/researchMetricCommand', 'Metric command'),
            { id: 'qaap-research-field-metric' },
        );
        const runLabel = createFormFieldLabel(
            nls.localize('qaap/mobileProjects/researchRunCommand', 'Run command (optional)'),
            { id: 'qaap-research-field-run' },
        );
        wireFormFieldLabel(descriptionLabel, descriptionInput);
        wireFormFieldLabel(cwdLabel, cwdInput);
        wireFormFieldLabel(metricLabel, metricCommandInput);
        wireFormFieldLabel(runLabel, runCommandInput);

        form.append(
            descriptionLabel,
            descriptionInput,
            cwdLabel,
            cwdInput,
            metricLabel,
            metricCommandInput,
            runLabel,
            runCommandInput,
        );

        const startBtn = document.createElement('button');
        startBtn.type = 'button';
        startBtn.className = 'theia-mobile-routine-btn theia-mod-primary q-button-primary';
        startBtn.textContent = nls.localize('qaap/mobileProjects/researchStart', 'Start research');
        startBtn.addEventListener('click', () => {
            void this.submitCreate({
                descriptionInput,
                cwdInput,
                metricCommandInput,
                runCommandInput,
                startBtn,
            });
        });

        const footer = document.createElement('footer');
        footer.className = 'theia-mobile-routine-sheet-footer';
        footer.append(startBtn);

        panel.append(handle, header, form, footer);
        sheet.append(backdrop, panel);
        document.body.append(sheet);
        this.host.researchSheet = sheet;

        this.escapeListener = (ev: KeyboardEvent): void => {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                ev.stopPropagation();
                this.closeResearchEditor();
            }
        };
        document.addEventListener('keydown', this.escapeListener, true);
        descriptionInput.focus();
    }

    closeResearchEditor(): void {
        if (this.escapeListener) {
            document.removeEventListener('keydown', this.escapeListener, true);
            this.escapeListener = undefined;
        }
        this.host.researchSheet?.remove();
        this.host.researchSheet = undefined;
        const restore = this.restoreFocusTo;
        this.restoreFocusTo = undefined;
        if (restore?.isConnected) {
            restore.focus();
        }
        if (this.host.visible && this.host.hubView === 'research') {
            this.host.renderList();
        }
    }

    protected async submitCreate(fields: {
        readonly descriptionInput: HTMLTextAreaElement;
        readonly cwdInput: HTMLInputElement;
        readonly metricCommandInput: HTMLInputElement;
        readonly runCommandInput: HTMLInputElement;
        readonly startBtn: HTMLButtonElement;
    }): Promise<void> {
        if (this.host.researchInteractionLock) {
            return;
        }
        const description = fields.descriptionInput.value.trim();
        const cwd = fields.cwdInput.value.trim();
        const metricCommand = fields.metricCommandInput.value.trim();
        const runCommand = fields.runCommandInput.value.trim();
        if (!description) {
            this.host.messageService?.warn(nls.localize(
                'qaap/mobileProjects/researchDescriptionRequired',
                'Enter a research goal description.',
            ));
            return;
        }
        if (!cwd) {
            this.host.messageService?.warn(nls.localize(
                'qaap/mobileProjects/researchCwdRequired',
                'Enter a working directory for the research goal.',
            ));
            return;
        }
        if (!metricCommand) {
            this.host.messageService?.warn(nls.localize(
                'qaap/mobileProjects/researchMetricRequired',
                'Enter a metric command.',
            ));
            return;
        }
        const body: QaapCreateResearchGoalBody = {
            cwd,
            description,
            metrics: [{ name: 'score', direction: 'min', metricCommand, primary: true }],
            runCommand: runCommand || undefined,
        };
        this.host.researchInteractionLock = true;
        fields.startBtn.disabled = true;
        try {
            await createResearchGoal(body);
            this.closeResearchEditor();
            await this.host.refreshResearchGoals(true);
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/researchStarted', 'Research started on the VPS'),
                { kind: 'success', duration: 2200 },
            );
        } catch (error) {
            this.host.messageService?.error(error instanceof Error ? error.message : String(error));
        } finally {
            this.host.researchInteractionLock = false;
            fields.startBtn.disabled = false;
        }
    }
}
