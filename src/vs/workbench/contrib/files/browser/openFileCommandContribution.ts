import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { WorkbenchContextKeys, WorkbenchContextKeysDIToken } from "../../../browser/workbenchContextKeys.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import type { IOpenUriOptions } from "../../../services/editor/common/editorService.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

export const OpenFileCommandContributionDIToken = token<OpenFileCommandContribution>("OpenFileCommandContribution");

/**
 * Регистрирует программную команду `workbench.openFile` (открыть файл по
 * абсолютному пути, вторым аргументом — {@link IOpenUriOptions}) — её
 * дёргают Explorer (активация файла, с `preview: true`) и Quick Open.
 * Команда без title: в палитру команд не попадает (как и раньше).
 */
export class OpenFileCommandContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [CommandRegistryDIToken, EditorServiceDIToken, WorkbenchContextKeysDIToken] as const;

    public constructor(
        commands: CommandRegistry,
        private readonly editorService: IEditorService,
        private readonly contextKeys: WorkbenchContextKeys,
    ) {
        super();
        this.register(
            commands.register("workbench.openFile", (absolutePath: unknown, options?: unknown) => {
                // Вторым аргументом приходят опции открытия — сейчас это только
                // `preview` от дерева Explorer. Аргументов нет (CLI, Quick Open,
                // палитра) — открываем постоянной вкладкой, как было.
                this.editorService.openFile(absolutePath as string, (options as IOpenUriOptions | undefined) ?? {});
                this.contextKeys.update();
            }),
        );
    }
}
