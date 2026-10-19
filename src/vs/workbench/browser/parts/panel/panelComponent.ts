import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { PaneCompositePartComponent } from "../paneCompositePartComponent.ts";

import type { PanelService } from "./panelService.ts";
import { PanelServiceDIToken } from "./panelService.ts";

export const PanelComponentDIToken = token<PanelComponent>("PanelComponent");

/**
 * Команда кнопки `×` в таб-строке панели. Объявлена здесь, рядом с
 * потребителем, а экшен (`closePanelAction`) её импортирует — как у
 * `FOCUS_MESSAGE_COMMAND_ID`: иначе компоненту пришлось бы тянуть весь модуль
 * экшенов воркбенча ради одной строки.
 */
export const CLOSE_PANEL_COMMAND_ID = "workbench.action.closePanel";

/**
 * Компонент нижней панели (`view.id = "panel"`): отражает реестр
 * {@link PanelService} в таб-строке. Механика — {@link PaneCompositePartComponent},
 * общая со вторичной боковой панелью.
 */
export class PanelComponent extends PaneCompositePartComponent {
    public static dependencies = [PanelServiceDIToken, CommandRegistryDIToken] as const;

    public constructor(panelService: PanelService, commands: CommandRegistry) {
        super(panelService, commands, "panel", CLOSE_PANEL_COMMAND_ID);
    }
}
