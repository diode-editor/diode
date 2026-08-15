import { Disposable, type IDisposable } from "@tuidom/core/common/disposable";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { MenuRegistry } from "../../../../platform/actions/common/menuRegistry.ts";
import { MenuRegistryDIToken } from "../../../../platform/actions/common/menuRegistry.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import { OUTPUT_VIEW_ID } from "../../../services/output/common/output.ts";
import type { OutputService } from "../../../services/output/common/outputService.ts";
import { OutputServiceDIToken } from "../../../services/output/common/outputService.ts";

export const OutputChannelActionsDIToken = token<OutputChannelActions>("OutputChannelActions");

/** Точка меню, в которой живут пункты-каналы (VS Code `workbench.output.menu.switchOutput`). */
export const SwitchOutputMenu = new MenuId("workbench.output.menu.switchOutput");

/** Префикс команд показа канала — VS Code `workbench.action.output.show.<id>`. */
const SHOW_CHANNEL_PREFIX = "workbench.action.output.show.";

/**
 * Регистрирует каналы Output как настоящие команды и пункты меню — так же, как
 * это делает `registerSwitchOutputAction` в VS Code.
 *
 * Зачем через меню, а не напрямую в селектор: канал становится полноценной
 * командой (`workbench.action.output.show.extensions`) — её видно в палитре и
 * можно повесить на клавишу. Само submenu помечено `isSelection`, и шапка
 * панели рендерит его выпадающим списком, а не вложенным попапом — в VS Code
 * этот же флаг превращает submenu в `SelectBox`.
 */
export class OutputChannelActions extends Disposable implements IWorkbenchContribution {
    public static dependencies = [OutputServiceDIToken, MenuRegistryDIToken, CommandRegistryDIToken] as const;

    private readonly registered = new Map<string, IDisposable[]>();

    public constructor(
        private readonly outputService: OutputService,
        private readonly menuRegistry: MenuRegistry,
        private readonly commands: CommandRegistry,
    ) {
        super();
        // Само submenu: пункт шапки вкладки OUTPUT, помеченный как выбор.
        this.register(
            this.menuRegistry.appendMenuItem({
                menuId: MenuId.ViewTitle,
                submenu: SwitchOutputMenu,
                title: "Switch Output",
                group: "navigation",
                order: 1,
                // Фильтр по контексту открытия, а не по глобальному ключу `view`:
                // `ViewTitle` — общая точка всех view, и when-ключ активной
                // вкладки панели протащил бы этот пункт в меню каждой секции
                // сайдбара.
                visible: viewMenuVisible(OUTPUT_VIEW_ID),
                isSelection: true,
            }),
        );

        for (const channel of this.outputService.getChannels()) this.registerChannel(channel.id, channel.label);
        this.register(
            this.outputService.onDidRegisterChannel((descriptor) => {
                this.registerChannel(descriptor.id, descriptor.label);
            }),
        );

        this.register({
            dispose: () => {
                for (const disposables of this.registered.values()) for (const d of disposables) d.dispose();
                this.registered.clear();
            },
        });
    }

    /**
     * Идемпотентность держит сам реестр каналов (`registerChannel` — no-op для
     * известного id и события второй раз не шлёт), поэтому своей проверки здесь
     * нет: два владельца одного инварианта разъезжаются.
     */
    private registerChannel(id: string, label: string): void {
        const commandId = `${SHOW_CHANNEL_PREFIX}${id}`;
        const disposables = [
            this.commands.register(
                commandId,
                () => {
                    this.outputService.showChannel(id);
                },
                `Output: Show ${label}`,
            ),
            this.menuRegistry.appendMenuItem({
                menuId: SwitchOutputMenu,
                command: commandId,
                title: label,
                // Отметка активного канала — VS Code `toggled:
                // ACTIVE_OUTPUT_CHANNEL_CONTEXT.isEqualTo(channel.id)`.
                toggled: `activeOutputChannel == '${id}'`,
            }),
        ];
        this.registered.set(id, disposables);
    }
}
