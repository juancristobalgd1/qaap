
import { writeStoredComposerSurface, type QaapComposerSurface } from '../common/qaap-composer-surface';
import { QAAP_PRIMARY_AGENT_ID, writeStoredAgent } from '../common/qaap-agent-task-client';
import type { MobileProjectEntry, MobileProjectFilter } from './mobile-projects-types';
import type { MobileBottomButtonId } from '@theia/qaap-mobile-mechanics/lib/browser/mobile-shell-bottom-bar-widget';
import type { MobileViewToggleId } from '../common/qaap-mobile-work-surface-preference';

export interface MobileProjectsComposerHeaderHost {
    visible: boolean;
    hubView: import('./mobile-projects-types').MobileProjectsHubView;
    root: HTMLElement;
    stickyComposerHost: HTMLElement;
    headerSurfacePickerHost: HTMLElement;
    accountBtn: HTMLButtonElement;
    headerSurfacePicker: import('./qaap-mobile-form-ui').QaapSegmentedFieldController<MobileBottomButtonId> | undefined;
    stickyComposerSurface: QaapComposerSurface;
    tasksHubSurface: QaapComposerSurface;
    stickyComposerFabLiftPx: number;
    projects: MobileProjectEntry[];
    filter: MobileProjectFilter;
    preparedCwdByProjectId: Map<string, string>;

    isProjectDetailView(): boolean;
    syncAgentsHubAccountChrome(): void;
    hubQueryUi: import('./mobile-projects-hub-query-ui').MobileProjectsHubQueryUi;
    projectNavigationUi: import('./qaap-composer-host-contracts').ComposerProjectNavigationApi;
    projectsService: import('./mobile-projects-service').MobileProjectsService;
    stickyComposerPinnedAgentId: string | undefined;
    stickyComposerRenderUi: import('./mobile-projects-sticky-composer-render-ui').MobileProjectsStickyComposerRenderUi;
    commands: import('@theia/core/lib/common/command').CommandRegistry;
    renderList(): void;
    renderSubtitle(): void;
    shouldUseAgentsHubLanding(): boolean;
    resolveHomePinnedProject(): MobileProjectEntry | undefined;
    isAgentsHubExecutionSurfaceReady(): boolean;
    ensureAgentsHubExecutionShellRendered(): void;
}

export class MobileProjectsComposerHeaderUi {
    constructor(protected readonly host: MobileProjectsComposerHeaderHost) { }

    syncHeaderComposerSurfacePicker(): void {
        this.host.headerSurfacePickerHost.hidden = true;
        this.host.headerSurfacePickerHost.replaceChildren();
        this.host.headerSurfacePicker = undefined;
        this.host.syncAgentsHubAccountChrome();
    }

    resolveActiveViewToggleId(): MobileViewToggleId {
        return 'agent';
    }

    updateStickyComposerFabLift(): void {
        const composerVisible = this.host.root.classList.contains('theia-mod-sticky-composer')
            && !this.host.stickyComposerHost.hidden
            && this.host.stickyComposerHost.offsetHeight > 0;
        const lift = composerVisible ? Math.round(this.host.stickyComposerHost.getBoundingClientRect().height) : 0;
        this.host.stickyComposerFabLiftPx = lift;
        this.host.root.style.setProperty('--theia-mobile-projects-fab-lift', `${lift}px`);
    }

    pinStickyComposerToQaiq(cwd: string | undefined): void {
        this.host.stickyComposerPinnedAgentId = QAAP_PRIMARY_AGENT_ID;
        writeStoredAgent(cwd, QAAP_PRIMARY_AGENT_ID);
    }

    resolveStickyComposerProject(projects: MobileProjectEntry[]): MobileProjectEntry | undefined {
        if (this.host.shouldUseAgentsHubLanding()) {
            return this.host.resolveHomePinnedProject();
        }
        const fromExpanded = this.host.projectNavigationUi.resolveSelectedProject(projects);
        if (fromExpanded) {
            return fromExpanded;
        }
        return this.host.projectsService.resolveCurrentWorkspaceProject(projects);
    }

    preferComposerSurface(surface: QaapComposerSurface, projectCwd?: string): void {
        void surface;
        writeStoredComposerSurface(projectCwd, 'task');
        this.host.stickyComposerSurface = 'task';
        if (this.host.visible && this.host.hubView === 'repos') {
            this.host.stickyComposerRenderUi.renderStickyComposer();
        }
    }

}
