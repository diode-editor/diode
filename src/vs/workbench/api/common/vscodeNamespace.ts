import type * as vscode from "vscode";

import { buildCommandsNamespace } from "./commandsNamespace.ts";
import { DocumentRegistry } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import type { RpcEndpoint } from "./rpcEndpoint.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import {
    CompletionItem,
    CompletionItemKind,
    DecorationRangeBehavior,
    DisposableImpl,
    EndOfLine,
    EventEmitter,
    FileChangeType,
    FileDecoration,
    FileSystemError,
    FileType,
    FoldingRange,
    FoldingRangeKind,
    Location,
    OverviewRulerLane,
    Position,
    Range,
    Selection,
    TextDocumentSaveReason,
    TextEdit,
    ThemeColor,
    Uri,
} from "./vscodeTypes.ts";
import { createWindowNamespace } from "./windowNamespace.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";
import { createWorkspaceNamespace } from "./workspaceNamespace.ts";

/**
 * Результат сборки шима: сам объект `vscode` (раздаётся расширениям через
 * `Module._cache`) и {@link WorkspaceConfigStore}, в который subprocess-entry
 * кладёт `configDefaults` расширения ДО `activate()`.
 */
export interface IVscodeHost {
    readonly namespace: typeof vscode;
    readonly configStore: WorkspaceConfigStore;
}

/**
 * Собирает объект `vscode`, раздаваемый расширениям (in-process в тестах или в
 * subprocess через `Module._cache`).
 *
 * Ассемблер держит общее состояние ({@link IVscodeHostContext}: реестр документов
 * со стабильной идентичностью и хранилище конфигурации) и композирует поверх него
 * namespace'ы `window` / `workspace` / `languages` / `commands`. Value-типы
 * (`Position`, `Range`, `TextEdit`, `Uri`, enum'ы, `EventEmitter`) отдаются как
 * runtime-поля — расширение делает `new vscode.Position(...)` и т.п.
 *
 * Все мутирующие действия проксируются хосту как RPC-запросы; прямой ссылки на
 * host-сервисы у `vscode`-неймспейса нет.
 */
export function buildVscodeNamespace(rpc: RpcEndpoint): IVscodeHost {
    const ctx: IVscodeHostContext = {
        rpc,
        registry: new DocumentRegistry(),
        configStore: new WorkspaceConfigStore(),
    };

    const window = createWindowNamespace(ctx);
    const workspace = createWorkspaceNamespace(ctx);
    const { languages } = createLanguagesNamespace(ctx);
    // WP4: commands bridge поверх симметричного rpc (локальная Map команд +
    // прокси в host CommandRegistry).
    const commands = buildCommandsNamespace(rpc);

    const namespace = {
        version: "vexx-phase-1",
        Disposable: DisposableImpl,
        // Value-типы — обязательно перечислить поимённо: каст `as unknown as
        // typeof vscode` прячет пропуск, он всплыл бы только рантайм-undefined
        // внутри расширения (`new vscode.Position(...)`).
        Position,
        Range,
        Selection,
        TextEdit,
        Uri,
        EventEmitter,
        CompletionItem,
        EndOfLine,
        TextDocumentSaveReason,
        FileChangeType,
        FileType,
        FileSystemError,
        CompletionItemKind,
        FoldingRange,
        FoldingRangeKind,
        Location,
        ThemeColor,
        FileDecoration,
        OverviewRulerLane,
        DecorationRangeBehavior,
        window,
        workspace,
        languages,
        commands,
    } as unknown as typeof vscode;

    return { namespace, configStore: ctx.configStore };
}
