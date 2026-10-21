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

/** У эталона — `closeAuxiliaryBar`. */
export const CLOSE_AUXILIARY_BAR_COMMAND_ID = "workbench.action.closeAuxiliaryBar";

/**
 * У эталона у `AuxiliaryBarPart` своих цветов нет: фон и текст `sideBar.*`,
 * вкладки — `panelTitle.*`. Первая колонка отдана сашу — на её месте у эталона
 * `sideBar.border`.
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
            // Отступление: у эталона «Drag a view here to display.», но перетаскивания видов у нас нет.
            emptyMessage: EMPTY_AUXILIARY_BAR_MESSAGE,
        });
    }

    public updateContextKeys(contextKeys: ContextKeyService, active: TUIElement | null): void {
        contextKeys.set("auxiliaryBarFocus", active?.getAncestorPath().includes(this.view) ?? false);
        const activeId = this.auxiliaryBarService.visible ? this.auxiliaryBarService.getActiveViewId() : null;
        contextKeys.set("activeAuxiliary", activeId ?? "");
    }
}
