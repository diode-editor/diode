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
import { TerminalLinkProvider } from "../common/terminalLinkProvider.ts";
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
