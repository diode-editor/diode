import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { PaneCompositePartComponent } from "../paneCompositePartComponent.ts";

import type { AuxiliaryBarService } from "./auxiliaryBarService.ts";
import { AuxiliaryBarServiceDIToken } from "./auxiliaryBarService.ts";

export const AuxiliaryBarComponentDIToken = token<AuxiliaryBarComponent>("AuxiliaryBarComponent");

export const EMPTY_AUXILIARY_BAR_MESSAGE = "Use 'View: Move View' to display a view here.";

/** Upstream: `closeAuxiliaryBar`. */
export const CLOSE_AUXILIARY_BAR_COMMAND_ID = "workbench.action.closeAuxiliaryBar";

/**
 * Upstream `AuxiliaryBarPart` has no colors of its own: background and text come from `sideBar.*`,
 * tabs from `panelTitle.*`. The first column belongs to the sash; upstream draws
 * `sideBar.border` there.
 */
export class AuxiliaryBarComponent extends PaneCompositePartComponent implements IContextKeyContributor {
    public static dependencies = [AuxiliaryBarServiceDIToken, CommandRegistryDIToken] as const;

    public constructor(
        private readonly auxiliaryBarService: AuxiliaryBarService,
        commands: CommandRegistry,
    ) {
        super(auxiliaryBarService, commands, "auxiliarybar", CLOSE_AUXILIARY_BAR_COMMAND_ID, {
            background: "sideBar.background",
            foreground: "sideBar.foreground",
            topBorder: false,
            contentLeft: 1,
            // Deviation: upstream says "Drag a view here to display.", but we have no view drag and drop.
            emptyMessage: EMPTY_AUXILIARY_BAR_MESSAGE,
        });
    }

    public updateContextKeys(contextKeys: ContextKeyService, active: TUIElement | null): void {
        contextKeys.set("auxiliaryBarFocus", active?.getAncestorPath().includes(this.view) ?? false);
        const activeId = this.auxiliaryBarService.visible ? this.auxiliaryBarService.getActiveViewId() : null;
        contextKeys.set("activeAuxiliary", activeId ?? "");
    }
}
