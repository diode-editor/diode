import { Disposable } from "@tuidom/core/common/disposable";

import { type CommandRegistry, CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStatusBarEntryHandle } from "../../statusbar/common/statusBarService.ts";
import type { StatusBarService } from "../../statusbar/common/statusBarService.ts";
import { StatusBarServiceDIToken } from "../../statusbar/common/statusBarService.ts";

import type { TerminalEnvironmentService } from "./terminalEnvironmentService.ts";
import { TerminalEnvironmentServiceDIToken } from "./terminalEnvironmentService.ts";

export const TerminalEnvStatusContributionDIToken = token<TerminalEnvStatusContribution>(
    "TerminalEnvStatusContribution",
);

/**
 * Публикует в {@link StatusBarService} компактный индикатор терминального
 * окружения (первый слева): tier + активные моды кроме неявного `local`
 * и рунг мак-лестницы, если клавиатура маковская (например "kitty",
 * "csi-u · ssh,tmux", "kitty · mac-cmd"). Подсказывает пользователю, что
 * терминал можно проапгрейдить. Обновляется по `onDidChange` сервиса
 * (finalize пробы / переключение мода). Клик открывает Keyboard Doctor.
 */
export class TerminalEnvStatusContribution extends Disposable {
    public static dependencies = [
        StatusBarServiceDIToken,
        TerminalEnvironmentServiceDIToken,
        CommandRegistryDIToken,
    ] as const;

    private readonly handle: IStatusBarEntryHandle;

    public constructor(
        statusBar: StatusBarService,
        private readonly terminalEnv: TerminalEnvironmentService,
        commands: CommandRegistry,
    ) {
        super();
        this.handle = this.register(
            statusBar.addEntry({
                id: "status.terminalEnvironment",
                name: "Terminal Environment",
                text: this.segmentText(),
                alignment: "left",
                priority: 100,
                // Клик — Keyboard Doctor: окружение, рунг и что реально приезжает с клавиатуры.
                onClick: () => {
                    void commands.execute("diode.keyboardDoctor");
                },
            }),
        );
        this.register(
            this.terminalEnv.onDidChange(() => {
                this.handle.update({ text: this.segmentText() });
            }),
        );
    }

    private segmentText(): string {
        const modes = [...this.terminalEnv.getActiveModes()].filter((m) => m !== "local").sort();
        const suffix = modes.length > 0 ? ` · ${modes.join(",")}` : "";
        const rung = this.terminalEnv.macKeysRung;
        const mac = rung === undefined ? "" : ` · mac-${rung}`;
        return `${this.terminalEnv.tier}${mac}${suffix}`;
    }
}
