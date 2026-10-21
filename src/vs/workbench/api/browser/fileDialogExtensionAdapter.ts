import { Uri } from "../../../base/common/uri.ts";
import type { IFileDialogService } from "../../services/dialogs/browser/fileDialogService.ts";
import type { IFileDialogSink } from "../common/iExtensionWindowSinks.ts";
import type { IWireOpenDialogRequest, IWireSaveDialogRequest } from "../common/wireTypes.ts";

/**
 * Диалог только локальный: `defaultUri` не со схемой `file` отбрасывается.
 * `openLabel`/`saveLabel` едут дальше, хотя кнопок у терминального диалога нет.
 */
export class FileDialogExtensionAdapter implements IFileDialogSink {
    public constructor(private readonly dialogs: IFileDialogService) {}

    public async showOpenDialog(request: IWireOpenDialogRequest): Promise<readonly string[] | undefined> {
        const uris = await this.dialogs.showOpenDialog({
            title: request.title,
            defaultUri: localUri(request.defaultUri),
            openLabel: request.openLabel,
            canSelectFiles: request.canSelectFiles,
            canSelectFolders: request.canSelectFolders,
            canSelectMany: request.canSelectMany,
            filters: request.filters,
        });
        return uris?.map((uri) => uri.toString());
    }

    public async showSaveDialog(request: IWireSaveDialogRequest): Promise<string | undefined> {
        const uri = await this.dialogs.showSaveDialog({
            title: request.title,
            defaultUri: localUri(request.defaultUri),
            saveLabel: request.saveLabel,
            filters: request.filters,
        });
        return uri?.toString();
    }
}

function localUri(raw: string | undefined): Uri | undefined {
    // Stryker disable next-line ConditionalExpression: `Uri.parse(undefined)` даёт ресурс без схемы `file` — ответ тот же, проверка лишь не гоняет разбор
    if (raw === undefined) return undefined;
    const uri = Uri.parse(raw);
    return uri.scheme === "file" ? uri : undefined;
}
