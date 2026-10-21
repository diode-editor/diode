import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
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

export const SwitchOutputMenu = new MenuId("workbench.output.menu.switchOutput");

const SHOW_CHANNEL_PREFIX = "workbench.action.output.show.";

/**
 * Channels are real commands and menu items, like upstream's `registerSwitchOutputAction`: they show up in
 * the command palette and can be bound to a key. The header renders a submenu with `isSelection` as a dropdown.
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
        this.register(
            this.menuRegistry.appendMenuItem({
                menuId: MenuId.ViewTitle,
                submenu: SwitchOutputMenu,
                title: "Switch Output",
                group: "navigation",
                order: 1,
                // Filter by the open context: `ViewTitle` is shared by all views, and the active tab's
                // when-key would drag the item into the menu of every sidebar section.
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

    /** No own duplicate check: the channel registry owns it — two owners of an invariant drift apart. */
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
                // Active channel check mark — VS Code `toggled:
                // ACTIVE_OUTPUT_CHANNEL_CONTEXT.isEqualTo(channel.id)`.
                toggled: `activeOutputChannel == '${id}'`,
            }),
        ];
        this.registered.set(id, disposables);
    }
}
