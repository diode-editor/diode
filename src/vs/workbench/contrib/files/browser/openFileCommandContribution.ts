import { Disposable } from "@tuidom/core/common/disposable";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { WorkbenchContextKeys, WorkbenchContextKeysDIToken } from "../../../browser/workbenchContextKeys.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import { EditorService, EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";

export const OpenFileCommandContributionDIToken = token<OpenFileCommandContribution>("OpenFileCommandContribution");

/**
 * Регистрирует программную команду `workbench.openFile` (открыть файл по
 * абсолютному пути) — её дёргают Explorer (активация файла) и Quick Open.
 * Команда без title: в палитру команд не попадает (как и раньше).
 */
export class OpenFileCommandContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [CommandRegistryDIToken, EditorServiceDIToken, WorkbenchContextKeysDIToken] as const;

    public constructor(
        commands: CommandRegistry,
        private readonly editorService: EditorService,
        private readonly contextKeys: WorkbenchContextKeys,
    ) {
        super();
        this.register(
            commands.register("workbench.openFile", (absolutePath: unknown) => {
                this.editorService.openFile(absolutePath as string);
                this.contextKeys.update();
            }),
        );
    }
}
