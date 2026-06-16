// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    AIContextVariable,
    AIVariableResolutionRequest,
    AIVariableService,
    PromptText,
} from '@theia/ai-core';
import { SkillService } from '@theia/ai-core/lib/browser/skill-service';
import { FILE_VARIABLE } from '@theia/ai-core/lib/browser/file-variable-contribution';
import { IMAGE_CONTEXT_VARIABLE } from '@theia/ai-chat/lib/common/image-context-variable';
import { QuickInputService, nls } from '@theia/core';
import { FileUploadService } from '@theia/filesystem/lib/common/upload/file-upload';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import {
    attachDeviceFilesOptimistic,
    attachDeviceImagesOptimistic,
    attachDeviceImagesFromPicker,
    attachDeviceFilesFromPicker,
    pickFilesFromDevice,
    type MobileComposerAttachHandlers,
} from './qaap-mobile-composer-device-attach';
import { MobileSnackbar } from './mobile-snackbar';
import {
    type MobileMcpAttachOptions,
    renderMobileMcpAttachView,
} from './qaap-mobile-mcp-attach-menu';
import { resolveComposerProjectFileAttachment } from '../common/qaap-mobile-composer-project-file-attach';

const QUERY_CONTEXT = { type: 'context-variable-picker' };

const WORKSPACE_CONTEXT_VARIABLE_NAMES = new Set([
    FILE_VARIABLE.name,
    IMAGE_CONTEXT_VARIABLE.name,
]);

export interface MobileContextAttachServices {
    readonly fileUploadService: FileUploadService;
    readonly fileService: FileService;
    readonly workspaceService: WorkspaceService;
}

type MobileContextAttachMenuSelection =
    | { kind: 'device-upload' }
    | { kind: 'device-files' }
    | { kind: 'device-images' }
    | { kind: 'project-file' }
    | { kind: 'skill'; skillName: string }
    | { kind: 'variable'; variable: AIContextVariable };

type MobileDeviceUploadKind = 'device-files' | 'device-images';

let activeMenu: HTMLElement | undefined;
let activeAnchor: HTMLElement | undefined;
let activeDismiss: (() => void) | undefined;

export function dismissMobileContextAttachMenu(): void {
    activeDismiss?.();
}

function canAttachProjectFile(attachServices?: MobileContextAttachServices): boolean {
    if (!attachServices) {
        return false;
    }
    return attachServices.workspaceService.opened && attachServices.workspaceService.tryGetRoots().length > 0;
}

function positionAttachMenu(menu: HTMLElement, anchor: HTMLElement): void {
    const margin = 8;
    const gap = 6;
    const anchorRect = anchor.getBoundingClientRect();
    const menuWidth = Math.max(menu.offsetWidth, 200);
    const menuHeight = menu.offsetHeight;
    let top = anchorRect.bottom + gap;
    const maxBottom = window.innerHeight - margin;
    if (top + menuHeight > maxBottom) {
        const aboveTop = anchorRect.top - gap - menuHeight;
        top = aboveTop >= margin ? aboveTop : Math.max(margin, maxBottom - menuHeight);
    }
    let left = anchorRect.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - menuWidth - margin));
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
}

function createAttachMenuItem(options: {
    iconClasses: string;
    label: string;
    hint?: string;
    submenu?: boolean;
    compact?: boolean;
    onSelect: () => void;
}): HTMLButtonElement {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'theia-mobile-projects-sticky-composer-attach-menu-item';
    if (options.compact) {
        item.classList.add('theia-mod-compact');
    }
    item.setAttribute('role', 'menuitem');

    const icon = document.createElement('span');
    icon.className = options.iconClasses;
    icon.setAttribute('aria-hidden', 'true');

    const body = document.createElement('span');
    body.className = 'theia-mobile-projects-sticky-composer-attach-menu-item-body';

    const label = document.createElement('span');
    label.className = 'theia-mobile-projects-sticky-composer-attach-menu-item-label';
    label.textContent = options.label;
    body.append(label);

    if (options.hint?.trim()) {
        const hint = document.createElement('span');
        hint.className = 'theia-mobile-projects-sticky-composer-attach-menu-item-hint';
        hint.textContent = options.hint.trim();
        body.append(hint);
    }

    item.append(icon, body);
    if (options.submenu) {
        const chevron = document.createElement('span');
        chevron.className = 'codicon codicon-chevron-right theia-mobile-projects-sticky-composer-attach-menu-item-chevron';
        chevron.setAttribute('aria-hidden', 'true');
        item.append(chevron);
        item.classList.add('theia-mod-has-submenu');
    }
    item.addEventListener('click', ev => {
        ev.stopPropagation();
        options.onSelect();
    });
    return item;
}

function createAttachMenuSeparator(): HTMLElement {
    const separator = document.createElement('div');
    separator.className = 'theia-mobile-projects-sticky-composer-attach-menu-separator';
    separator.setAttribute('role', 'separator');
    return separator;
}

function createAttachMenuBackButton(label: string, onBack: () => void): HTMLButtonElement {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'theia-mobile-projects-sticky-composer-attach-menu-back';
    item.setAttribute('role', 'menuitem');
    const icon = document.createElement('span');
    icon.className = 'codicon codicon-arrow-left';
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = label;
    item.append(icon, text);
    item.addEventListener('click', ev => {
        ev.stopPropagation();
        onBack();
    });
    return item;
}

function showDeviceUploadKindMenu(anchor: HTMLElement): Promise<MobileDeviceUploadKind | undefined> {
    return new Promise(resolve => {
        const menu = document.createElement('div');
        menu.className = 'theia-mobile-projects-sticky-composer-attach-menu theia-mod-open theia-mod-device-upload-kind';
        menu.setAttribute('role', 'menu');
        menu.tabIndex = -1;

        const finish = (kind: MobileDeviceUploadKind | undefined): void => {
            dismissMobileContextAttachMenu();
            resolve(kind);
        };

        menu.append(createAttachMenuItem({
            iconClasses: 'codicon codicon-file',
            label: nls.localize(
                'qaap/mobileProjects/stickyComposerAttachDeviceFileShort',
                'File',
            ),
            hint: nls.localize(
                'qaap/mobileProjects/stickyComposerAttachDeviceFileHint',
                'Upload a file from this phone or tablet',
            ),
            onSelect: () => finish('device-files'),
        }));
        menu.append(createAttachMenuItem({
            iconClasses: 'codicon codicon-file-media',
            label: nls.localize(
                'qaap/mobileProjects/stickyComposerAttachDeviceImageShort',
                'Photo or image',
            ),
            hint: nls.localize(
                'qaap/mobileProjects/stickyComposerAttachDeviceImageHint',
                'Attach a photo or screenshot from this device',
            ),
            onSelect: () => finish('device-images'),
        }));

        document.body.appendChild(menu);
        activeMenu = menu;
        activeAnchor = anchor;
        anchor.setAttribute('aria-expanded', 'true');
        anchor.classList.add('theia-mod-active');

        const onPointerDown = (event: PointerEvent): void => {
            const target = event.target as Node | null;
            if (target && (menu.contains(target) || anchor.contains(target))) {
                return;
            }
            finish(undefined);
        };
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                event.preventDefault();
                finish(undefined);
                anchor.focus();
            }
        };

        const dismiss = (): void => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown, true);
            menu.remove();
            if (activeMenu === menu) {
                activeMenu = undefined;
            }
            if (activeDismiss === dismiss) {
                activeDismiss = undefined;
            }
            if (activeAnchor === anchor) {
                anchor.setAttribute('aria-expanded', 'false');
                anchor.classList.remove('theia-mod-active');
                activeAnchor = undefined;
            }
        };

        activeDismiss = dismiss;

        requestAnimationFrame(() => {
            positionAttachMenu(menu, anchor);
            document.addEventListener('pointerdown', onPointerDown, true);
            document.addEventListener('keydown', onKeyDown, true);
            menu.focus();
        });
    });
}

function showContextAttachMenu(
    anchor: HTMLElement,
    variables: readonly AIContextVariable[],
    includeDeviceAttach: boolean,
    skills: readonly { readonly name: string; readonly description: string }[],
    includeSkillsPicker: boolean,
    mcpOptions?: MobileMcpAttachOptions,
    includeProjectFile = false,
): Promise<MobileContextAttachMenuSelection | undefined> {
    if (!includeDeviceAttach && !variables.length && !includeSkillsPicker && !mcpOptions && !includeProjectFile) {
        return Promise.resolve(undefined);
    }
    if (activeAnchor === anchor && activeMenu) {
        dismissMobileContextAttachMenu();
        return Promise.resolve(undefined);
    }
    dismissMobileContextAttachMenu();

    return new Promise(resolve => {
        const menu = document.createElement('div');
        menu.className = 'theia-mobile-projects-sticky-composer-attach-menu theia-mod-open';
        menu.setAttribute('role', 'menu');
        menu.tabIndex = -1;

        const menuBody = document.createElement('div');
        menuBody.className = 'theia-mobile-projects-sticky-composer-attach-menu-body';
        menu.append(menuBody);

        const finish = (selection: MobileContextAttachMenuSelection | undefined): void => {
            dismissMobileContextAttachMenu();
            resolve(selection);
        };

        let showingSkills = false;
        let showingMcp = false;

        const renderMainView = (): void => {
            showingSkills = false;
            showingMcp = false;
            menu.classList.remove('theia-mod-skills-view', 'theia-mod-mcp-view');
            menuBody.replaceChildren();

            if (includeDeviceAttach) {
                menuBody.append(createAttachMenuItem({
                    iconClasses: 'codicon codicon-cloud-upload',
                    label: nls.localize(
                        'qaap/mobileProjects/stickyComposerAttachDeviceUpload',
                        'Upload from device',
                    ),
                    hint: nls.localize(
                        'qaap/mobileProjects/stickyComposerAttachDeviceUploadHint',
                        'Choose a file or photo from this device',
                    ),
                    onSelect: () => finish({ kind: 'device-upload' }),
                }));
                if (variables.length > 0 || includeSkillsPicker || mcpOptions || includeProjectFile) {
                    menuBody.append(createAttachMenuSeparator());
                }
            }

            if (includeProjectFile) {
                menuBody.append(createAttachMenuItem({
                    iconClasses: 'codicon codicon-file',
                    label: nls.localizeByDefault('File'),
                    hint: nls.localize(
                        'qaap/mobileProjects/stickyComposerAttachProjectFileHint',
                        'Search and attach a file from this workspace',
                    ),
                    onSelect: () => finish({ kind: 'project-file' }),
                }));
            }

            if (includeSkillsPicker) {
                menuBody.append(createAttachMenuItem({
                    iconClasses: 'codicon codicon-book',
                    label: nls.localize('qaap/mobileProjects/stickyComposerAttachSkills', 'Skills'),
                    hint: nls.localize(
                        'qaap/mobileProjects/stickyComposerAttachSkillsHint',
                        'Insert a skill into your prompt',
                    ),
                    submenu: true,
                    onSelect: () => renderSkillsView(),
                }));
            }

            if (mcpOptions) {
                menuBody.append(createAttachMenuItem({
                    iconClasses: 'codicon codicon-plug',
                    label: nls.localize('qaap/mobileProjects/stickyComposerAttachMcpServers', 'MCP Servers'),
                    hint: nls.localize(
                        'qaap/mobileProjects/stickyComposerAttachMcpServersHint',
                        'Enable or disable MCP plugins for this agent',
                    ),
                    submenu: true,
                    onSelect: () => renderMcpView(),
                }));
            }

            if ((includeProjectFile || includeSkillsPicker || mcpOptions) && variables.length > 0) {
                menuBody.append(createAttachMenuSeparator());
            }

            for (const variable of variables) {
                menuBody.append(createAttachMenuItem({
                    iconClasses: variable.iconClasses?.join(' ') ?? 'codicon codicon-symbol-variable',
                    label: variable.label ?? variable.name,
                    hint: variable.description?.trim(),
                    onSelect: () => finish({ kind: 'variable', variable }),
                }));
            }
            menu.focus();
        };

        const renderMcpView = (): void => {
            if (!mcpOptions) {
                return;
            }
            showingMcp = true;
            menu.classList.add('theia-mod-mcp-view');
            renderMobileMcpAttachView({
                menuBody,
                mcpOptions,
                onBack: () => renderMainView(),
                onCloseMenu: () => finish(undefined),
            });
            menu.focus();
        };

        const renderSkillsView = (): void => {
            showingSkills = true;
            showingMcp = false;
            menu.classList.add('theia-mod-skills-view');
            menuBody.replaceChildren();
            menuBody.append(createAttachMenuBackButton(
                nls.localize('qaap/mobileProjects/stickyComposerAttachBack', 'Back'),
                () => renderMainView(),
            ));
            menuBody.append(createAttachMenuSeparator());
            if (skills.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'theia-mobile-projects-sticky-composer-attach-menu-empty';
                empty.textContent = nls.localize(
                    'qaap/mobileProjects/stickyComposerAttachSkillsEmpty',
                    'No skills found. Add SKILL.md folders under ~/.cursor/skills or ~/.claude/skills.',
                );
                menuBody.append(empty);
            } else {
                for (const skill of skills) {
                    menuBody.append(createAttachMenuItem({
                        iconClasses: 'codicon codicon-book',
                        label: skill.name,
                        hint: skill.description?.trim(),
                        compact: true,
                        onSelect: () => finish({ kind: 'skill', skillName: skill.name }),
                    }));
                }
            }
            menu.focus();
        };

        document.body.appendChild(menu);
        activeMenu = menu;
        activeAnchor = anchor;
        anchor.setAttribute('aria-expanded', 'true');
        anchor.classList.add('theia-mod-active');

        const onPointerDown = (event: PointerEvent): void => {
            const target = event.target as Node | null;
            if (target && (menu.contains(target) || anchor.contains(target))) {
                return;
            }
            finish(undefined);
        };
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                event.preventDefault();
                if (showingMcp) {
                    renderMainView();
                    return;
                }
                if (showingSkills) {
                    renderMainView();
                    return;
                }
                finish(undefined);
                anchor.focus();
            }
        };

        const dismiss = (): void => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown, true);
            menu.remove();
            if (activeMenu === menu) {
                activeMenu = undefined;
            }
            if (activeDismiss === dismiss) {
                activeDismiss = undefined;
            }
            if (activeAnchor === anchor) {
                anchor.setAttribute('aria-expanded', 'false');
                anchor.classList.remove('theia-mod-active');
                activeAnchor = undefined;
            }
        };

        activeDismiss = dismiss;

        requestAnimationFrame(() => {
            renderMainView();
            positionAttachMenu(menu, anchor);
            document.addEventListener('pointerdown', onPointerDown, true);
            document.addEventListener('keydown', onKeyDown, true);
        });
    });
}

async function resolveVariableArguments(
    variable: AIContextVariable,
    variableService: AIVariableService,
    quickInputService: QuickInputService,
): Promise<AIVariableResolutionRequest | undefined> {
    if (!variable.args || variable.args.length === 0) {
        return { variable };
    }

    const argumentPicker = await variableService.getArgumentPicker(variable.name, QUERY_CONTEXT);
    if (!argumentPicker) {
        return useGenericArgumentPicker(variable, quickInputService);
    }
    const arg = await argumentPicker(QUERY_CONTEXT);
    if (!arg) {
        return undefined;
    }
    return { variable, arg };
}

async function useGenericArgumentPicker(
    variable: AIContextVariable,
    quickInputService: QuickInputService,
): Promise<AIVariableResolutionRequest | undefined> {
    const args: string[] = [];
    for (const argument of variable.args ?? []) {
        const placeHolder = argument.description;
        let input: string | undefined;
        if (argument.enum) {
            const picked = await quickInputService.pick(
                argument.enum.map(enumItem => ({ label: enumItem })),
                { placeHolder, canPickMany: false },
            );
            input = picked?.label;
        } else {
            input = await quickInputService.input({ placeHolder });
        }
        if (!input && !argument.isOptional) {
            return undefined;
        }
        args.push(input ?? '');
    }
    return { variable, arg: args.join(PromptText.VARIABLE_SEPARATOR_CHAR) };
}

function filterMobileContextVariables(variables: readonly AIContextVariable[]): AIContextVariable[] {
    return variables.filter(variable => !WORKSPACE_CONTEXT_VARIABLE_NAMES.has(variable.name));
}

async function resolveDeviceAttachSelection(
    selection: MobileContextAttachMenuSelection,
    attachServices: MobileContextAttachServices,
    handlers?: MobileComposerAttachHandlers,
): Promise<AIVariableResolutionRequest[]> {
    try {
        if (selection.kind === 'device-images') {
            const files = await pickFilesFromDevice({ accept: 'image/*', multiple: true });
            if (files.length === 0) {
                return [];
            }
            if (handlers) {
                attachDeviceImagesOptimistic(files, handlers);
                return [];
            }
            return attachDeviceImagesFromPicker();
        }
        const files = await pickFilesFromDevice({ multiple: true });
        if (files.length === 0) {
            return [];
        }
        if (handlers) {
            attachDeviceFilesOptimistic(files, attachServices, handlers);
            return [];
        }
        return attachDeviceFilesFromPicker(attachServices);
    } catch (error) {
        const message = error instanceof Error && error.message
            ? error.message
            : nls.localize(
                'qaap/mobileProjects/stickyComposerAttachDeviceFailed',
                'Could not attach files from this device.',
            );
        MobileSnackbar.show(message, { kind: 'warning', duration: 3200 });
        return [];
    }
}

/** Mobile attach control: device files/images, skills, plus context variables in a menu anchored to the button. */
export async function pickMobileContextVariable(
    anchor: HTMLElement,
    variableService: AIVariableService,
    quickInputService: QuickInputService,
    attachServices?: MobileContextAttachServices,
    handlers?: MobileComposerAttachHandlers,
    skillService?: SkillService,
    mcpOptions?: MobileMcpAttachOptions,
): Promise<AIVariableResolutionRequest[]> {
    const variables = filterMobileContextVariables(variableService.getContextVariables());
    if (skillService) {
        await skillService.ready;
    }
    const skills = skillService?.getSkills() ?? [];
    const includeProjectFile = canAttachProjectFile(attachServices);
    const selected = await showContextAttachMenu(
        anchor,
        variables,
        !!attachServices,
        skills,
        !!skillService,
        mcpOptions,
        includeProjectFile,
    );
    if (!selected) {
        return [];
    }
    if (selected.kind === 'skill') {
        handlers?.insertComposerSkill?.(selected.skillName);
        return [];
    }
    if (selected.kind === 'device-upload') {
        const uploadKind = await showDeviceUploadKindMenu(anchor);
        if (!uploadKind) {
            return [];
        }
        return resolveDeviceAttachSelection({ kind: uploadKind }, attachServices!, handlers);
    }
    if (selected.kind === 'device-files' || selected.kind === 'device-images') {
        return resolveDeviceAttachSelection(selected, attachServices!, handlers);
    }
    if (selected.kind === 'project-file') {
        const resolved = await resolveComposerProjectFileAttachment(variableService, FILE_VARIABLE);
        return resolved ? [resolved] : [];
    }
    const resolved = await resolveVariableArguments(selected.variable, variableService, quickInputService);
    return resolved ? [resolved] : [];
}
