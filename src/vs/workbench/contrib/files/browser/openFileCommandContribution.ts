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

/** Без title — в палитру команд не попадает. */
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
                // Без опций (CLI, Quick Open, палитра) — постоянная вкладка; `preview` шлёт только дерево.
                this.editorService.openFile(absolutePath as string, (options as IOpenUriOptions | undefined) ?? {});
                this.contextKeys.update();
            }),
        );
    }
}
