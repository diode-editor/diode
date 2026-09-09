import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ProgressService } from "../../../../platform/progress/common/progressService.ts";
import { ProgressServiceDIToken } from "../../../../platform/progress/common/progressService.ts";
import type { StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { showTransientNotice } from "../../../services/statusbar/common/transientNotice.ts";
import type {
    IExtensionInstallResult,
    IExtensionOperationResult,
    IExtensionsWorkbenchService,
} from "../common/extensionsWorkbench.ts";
import { ExtensionsWorkbenchServiceDIToken } from "../common/extensionsWorkbench.ts";

/**
 * Действия страницы расширения — всё, что нужно кнопкам сверх самого магазина:
 * индикатор длительной операции, сообщение о результате и перезагрузка окна.
 *
 * Отдельно от сервиса, потому что это уже про окно, а не про магазин: сервис
 * живёт в `node/` и о статус-баре с прогрессом ничего не знает.
 */

/** Id записи статус-бара с результатом операции (перетирает предыдущую). */
const NOTICE_ID = "extensions.operation.notice";

/** Что странице нужно уметь сверх самого магазина. */
export interface IExtensionPageActions {
    install(id: string): Promise<IExtensionInstallResult>;
    uninstall(id: string): Promise<IExtensionOperationResult>;
    reloadWindow(): void;
}

export class ExtensionPageActions implements IExtensionPageActions {
    public static dependencies = [
        ExtensionsWorkbenchServiceDIToken,
        ProgressServiceDIToken,
        StatusBarServiceDIToken,
        CommandRegistryDIToken,
    ] as const;

    public constructor(
        private readonly service: IExtensionsWorkbenchService,
        private readonly progress: ProgressService,
        private readonly statusBar: StatusBarService,
        private readonly commands: CommandRegistry,
    ) {}

    /**
     * Ставит расширение (она же операция «обновить»). Прогресс неопределённый:
     * канала процентов у загрузки артефакта нет, поэтому показываем сам факт
     * работы — запись в статус-баре со спиннером.
     */
    public async install(id: string): Promise<IExtensionInstallResult> {
        // Stryker disable next-line StringLiteral: ProgressService различает только "view" — любая другая локация это окно, поэтому подмена строки ничего не меняет
        const result = await this.progress.withProgress({ location: "window", title: `Installing ${id}` }, () =>
            this.service.install(id),
        );
        if (result.ok) {
            this.notice(`Installed ${id}@${result.version} — reload window to activate`);
        }
        return result;
    }

    /** Удаляет расширение. */
    public async uninstall(id: string): Promise<IExtensionOperationResult> {
        // Stryker disable next-line StringLiteral: та же локация «окно», см. install выше
        const result = await this.progress.withProgress({ location: "window", title: `Uninstalling ${id}` }, () =>
            this.service.uninstall(id),
        );
        if (result.ok) {
            this.notice(`Uninstalled ${id} — reload window to apply`);
        }
        return result;
    }

    /**
     * Перезагрузка окна — через команду, а не через шов напрямую: так и кнопка
     * страницы, и палитра идут одним путём, включая вопрос о несохранённых
     * вкладках.
     */
    public reloadWindow(): void {
        this.commands.execute("workbench.action.reloadWindow");
    }

    private notice(text: string): void {
        showTransientNotice(this.statusBar, NOTICE_ID, text);
    }
}

export const ExtensionPageActionsDIToken = token<IExtensionPageActions>("ExtensionPageActions");
