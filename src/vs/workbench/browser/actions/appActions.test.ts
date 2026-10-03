import { describe, expect, it, vi } from "vitest";

import { registerAction } from "../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import { Container } from "../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { DialogService } from "../../services/dialogs/browser/dialogService.ts";
import { LifecycleService, LifecycleServiceDIToken } from "../../services/lifecycle/browser/lifecycleService.ts";
import { HostProcessDIToken } from "../../services/lifecycle/common/hostProcess.ts";

import { quitAction, reloadWindowAction } from "./appActions.ts";

function setup() {
    const accessor = new Container();
    const lifecycle = new LifecycleService(new DialogService());
    const host = { exit: vi.fn(), restart: vi.fn() };
    const reasons: string[] = [];
    lifecycle.onWillShutdown((event) => reasons.push(event.reason));
    accessor.bind(LifecycleServiceDIToken, () => lifecycle);
    accessor.bind(HostProcessDIToken, () => host);
    const commands = new CommandRegistry();
    const keybindings = new KeybindingRegistry();
    registerAction(commands, keybindings, accessor, quitAction);
    registerAction(commands, keybindings, accessor, reloadWindowAction);
    return { commands, host, reasons };
}

describe("AppActions — выход и перезагрузка окна", () => {
    it("quit прощается с причиной quit и завершает процесс", async () => {
        const { commands, host, reasons } = setup();

        await commands.execute(quitAction.id);

        expect(reasons).toEqual(["quit"]);
        expect(host.exit).toHaveBeenCalledOnce();
        expect(host.restart).not.toHaveBeenCalled();
    });

    it("reload прощается с причиной reload и заменяет процесс новым", async () => {
        const { commands, host, reasons } = setup();

        await commands.execute(reloadWindowAction.id);

        expect(reasons).toEqual(["reload"]);
        expect(host.restart).toHaveBeenCalledOnce();
        expect(host.exit).not.toHaveBeenCalled();
    });
});
