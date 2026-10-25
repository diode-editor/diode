import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";

import { currentOperatingSystem } from "../../../../../base/common/platform.ts";
import type { IConfigurationService } from "../../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { IEnvironmentService } from "../../../../../platform/environment/common/environment.ts";
import { IEnvironmentServiceDIToken } from "../../../../../platform/environment/common/environment.ts";
import type { IFileService } from "../../../../../platform/files/common/files.ts";
import { IFileServiceDIToken } from "../../../../../platform/files/common/files.ts";
import { token } from "../../../../../platform/instantiation/common/diContainer.ts";
import type { IWorkspaceContextService } from "../../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import type { ITerminalInstance } from "../../../terminal/browser/terminalService.ts";
import { getDetectedLinks, getRecentFileLink, type IDetectedLinks } from "../common/terminalDetectedLinks.ts";
import { type ITerminalLink, TerminalLinkProvider } from "../common/terminalLinkProvider.ts";
import { TerminalLinkResolver } from "../common/terminalLinkResolver.ts";

import type { TerminalLinkOpener } from "./terminalLinkOpener.ts";
import { TerminalLinkSurface } from "./terminalLinkSurface.ts";

export const TerminalLinkOpenerDIToken = token<TerminalLinkOpener>("TerminalLinkOpener");

export const TerminalLinkServiceDIToken = token<TerminalLinkService>("TerminalLinkService");

/**
 * Upstream `TerminalLinkContribution`: file links for every terminal widget — the panel, editor tabs, extension
 * and task terminals alike. The `enableFileLinks` value is read once per instance, so a change applies to new
 * terminals only, as in upstream.
 */
export class TerminalLinkService {
    public static dependencies = [
        IConfigurationServiceDIToken,
        IFileServiceDIToken,
        IWorkspaceContextServiceDIToken,
        IEnvironmentServiceDIToken,
        TerminalLinkOpenerDIToken,
    ] as const;

    /** Per instance: the setting at creation and the resolver whose cache survives moving the terminal. */
    private readonly links = new WeakMap<ITerminalInstance, TerminalLinkProvider | null>();
    /** The surface of the instance's current widget: the one on screen after a move between hosts. */
    private readonly surfaces = new WeakMap<ITerminalInstance, TerminalLinkSurface>();

    public constructor(
        private readonly configuration: IConfigurationService,
        private readonly fileService: IFileService,
        private readonly workspace: IWorkspaceContextService,
        private readonly environment: IEnvironmentService,
        private readonly opener: TerminalLinkOpener,
    ) {}

    public createWidget(instance: ITerminalInstance): TerminalViewElement {
        const provider = this.providerFor(instance);
        if (provider === null) return new TerminalViewElement(instance.session);
        const surface = new TerminalLinkSurface(instance.session, provider, (link) => this.opener.open(link));
        this.surfaces.set(instance, surface);
        const widget = new TerminalViewElement(surface);
        widget.addEventListener("mouseleave", () => {
            surface.pointerLeft();
        });
        widget.addEventListener("keydown", (event) => {
            if (event.key === "Control") surface.setModifier(true);
            else surface.clearHover();
        });
        widget.addEventListener("keyup", (event) => {
            if (event.key === "Control") surface.setModifier(false);
        });
        return widget;
    }

    /** Upstream `TerminalLinkManager.getLinks`; nothing with `enableFileLinks: "off"` or before the emulator loads. */
    public getLinks(instance: ITerminalInstance): {
        readonly viewport: Promise<IDetectedLinks>;
        readonly all: Promise<IDetectedLinks>;
    } {
        const provider = this.providerFor(instance);
        const buffer = instance.session.buffer;
        if (provider === null || buffer === undefined) {
            const none = Promise.resolve<IDetectedLinks>({ fileLinks: [], folderLinks: [] });
            return { viewport: none, all: none };
        }
        return getDetectedLinks(buffer, provider);
    }

    /** Upstream `openRecentLink('localFile')`: opens the bottom file link, as a Ctrl+click on it would. */
    public async openRecentLink(instance: ITerminalInstance): Promise<void> {
        const provider = this.providerFor(instance);
        const buffer = instance.session.buffer;
        if (provider === null || buffer === undefined) return;
        const link = await getRecentFileLink(buffer, provider);
        if (link !== undefined) await this.opener.open(link);
    }

    /**
     * Upstream `markTracker.revealRange`: the link is underlined and, when its first row is off screen, scrolled to a
     * quarter of the viewport from the top (the output below a path matters more than above it).
     */
    public revealLink(instance: ITerminalInstance, link: ITerminalLink | undefined): void {
        this.surfaces.get(instance)?.setRevealedLink(link);
        const buffer = instance.session.buffer;
        if (link === undefined || buffer === undefined) return;
        const top = buffer.viewportY;
        if (link.start.y >= top && link.start.y < top + buffer.rows) return;
        const target = Math.max(link.start.y - Math.floor(buffer.rows / 4), 0);
        instance.session.scrollLines(target - top);
    }

    private providerFor(instance: ITerminalInstance): TerminalLinkProvider | null {
        const known = this.links.get(instance);
        if (known !== undefined) return known;
        const enabled = this.configuration.get("terminal.integrated.enableFileLinks") !== "off";
        const provider = enabled ? this.createProvider(instance) : null;
        this.links.set(instance, provider);
        return provider;
    }

    private createProvider(instance: ITerminalInstance): TerminalLinkProvider {
        const os = currentOperatingSystem();
        const resolver = new TerminalLinkResolver(this.fileService, {
            os,
            userHome: this.environment.userHome,
            getCwds: async () => {
                const cwd = (await instance.session.getCwd?.()) ?? instance.launch.cwd;
                const roots = this.workspace.getWorkspace().folders.map((folder) => folder.uri.fsPath);
                // A repeated directory costs nothing: the resolver caches by absolute path.
                return [cwd, ...roots];
            },
        });
        return new TerminalLinkProvider({
            resolver,
            os,
            isInWorkspace: (uri) => this.workspace.getWorkspaceFolder(uri) !== null,
        });
    }
}
