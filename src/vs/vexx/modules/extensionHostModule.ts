import * as path from "node:path";

import { Uri } from "../../base/common/uri.ts";
import { createRange } from "../../editor/common/core/iRange.ts";
import { CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { type IMarkerData, MarkerSeverity } from "../../platform/markers/common/iMarker.ts";
import { IConfigurationServiceDIToken } from "../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import { ILogServiceDIToken } from "../../platform/log/common/iLogServiceDIToken.ts";
import { LogLevel } from "../../platform/log/common/logLevel.ts";
import { CommandServiceAdapter } from "../../workbench/api/browser/commandServiceAdapter.ts";
import { activeDocumentSnapshot, bindDocumentSync } from "../../workbench/api/browser/documentSyncAdapter.ts";
import { ExtensionOutputAdapter } from "../../workbench/api/browser/extensionOutputAdapter.ts";
import { ProgressStatusBarAdapter } from "../../workbench/api/browser/progressStatusBarAdapter.ts";
import type { WireMarker } from "../../workbench/api/common/wireTypes.ts";
import { EditorDecorationsServiceAdapter } from "../../workbench/api/browser/editorDecorationsServiceAdapter.ts";
import { EditorOptionsServiceAdapter } from "../../workbench/api/browser/editorOptionsServiceAdapter.ts";
import { FileDecorationsServiceAdapter } from "../../workbench/api/browser/fileDecorationsServiceAdapter.ts";
import { FileSystemProviderAdapter } from "../../workbench/api/browser/fileSystemProviderAdapter.ts";
import { ThemeColorResolverAdapter } from "../../workbench/api/browser/themeColorResolverAdapter.ts";
import { FileSystemProviderRegistryDIToken, MarkerServiceDIToken } from "../../workbench/common/coreTokens.ts";
import { ExplorerServiceDIToken } from "../../workbench/contrib/files/browser/explorerService.ts";
import { EditorServiceDIToken } from "../../workbench/services/editor/browser/editorService.ts";
import {
    ExtensionHost,
    ExtensionHostDIToken,
    type IExtensionHostConfigProvider,
} from "../../workbench/services/extensions/node/extensionHost.ts";
import { PanelServiceDIToken } from "../../workbench/browser/parts/panel/panelService.ts";
import { OUTPUT_VIEW_ID, OutputChannelRegistryDIToken } from "../../workbench/services/output/common/output.ts";
import { OutputServiceDIToken } from "../../workbench/services/output/common/outputService.ts";
import { LayoutServiceDIToken } from "../../workbench/services/layout/browser/layoutService.ts";
import { StatusBarServiceDIToken } from "../../workbench/services/statusbar/common/statusBarService.ts";
import { ThemeServiceDIToken } from "../../workbench/services/themes/common/themeTokens.ts";

/** `vscode.DiagnosticSeverity` (0=Error…3=Hint) → `MarkerSeverity`. */
function toMarkerSeverity(severity: number): MarkerSeverity {
    switch (severity) {
        case 1:
            return MarkerSeverity.Warning;
        case 2:
            return MarkerSeverity.Info;
        case 3:
            return MarkerSeverity.Hint;
        default:
            return MarkerSeverity.Error;
    }
}

/**
 * DI-модуль extension host'а. Связывает `EditorService` →
 * `IEditorOptionsService` → `ExtensionHost`. В production хост создаётся
 * пустым (без зарегистрированных расширений) — `main` builtin-расширений
 * пока не исполняется; всё подключение идёт в тестах через харнесс.
 *
 * Логгеры (`extensions.host`, `extensions.host.rpc`, `.stdout`, `.stderr`)
 * берутся из `ILogService` — в тестах профиль использует `NULL_LOG_SERVICE`,
 * `isEnabled` всегда `false`, поэтому stdio остаётся в режиме `"inherit"`.
 */
export const extensionHostModule: ContainerModule = (container) => {
    container.bind(ExtensionHostDIToken, () => {
        const group = container.get(EditorServiceDIToken);
        const adapter = new EditorOptionsServiceAdapter(group);
        const commandAdapter = new CommandServiceAdapter(container.get(CommandRegistryDIToken));
        const logService = container.get(ILogServiceDIToken);
        const logger = logService.createLogger("extensions.host");
        const rpcLogger = logService.createLogger("extensions.host.rpc");
        const stdoutLogger = logService.createLogger("extensions.host.stdout");
        const stderrLogger = logService.createLogger("extensions.host.stderr");
        // \u0414\u043b\u044f NULL_LOG_SERVICE \u0432\u0441\u0435 \u0443\u0440\u043e\u0432\u043d\u0438 \u043e\u0442\u043a\u043b\u044e\u0447\u0435\u043d\u044b \u2014 \u043d\u0435 \u043f\u0435\u0440\u0435\u043a\u043b\u044e\u0447\u0430\u0435\u043c stdio \u0432 \"pipe\".
        const wantStdio = (lg: typeof stdoutLogger): typeof stdoutLogger | undefined =>
            lg.isEnabled(LogLevel.Info) ? lg : undefined;

        // Провайдер конфигурации: снапшот настроек + единственная папка воркспейса
        // (пока нет multi-root). Папку читаем ЛЕНИВО из ExplorerService (источник
        // правды, выставляется `WorkbenchComponent.setWorkspaceFolder`): getWorkspaceFolders
        // зовётся при инициализации subprocess'а — уже ПОСЛЕ setWorkspaceFolder, так
        // что расширения (напр. git) видят реально открытую папку, а не process.cwd().
        // Fallback на cwd, когда папка не открыта. Слой Configuration не тянется в
        // рантайм host'а — доступ идёт через этот тонкий адаптер.
        const configService = container.get(IConfigurationServiceDIToken);
        const explorer = container.get(ExplorerServiceDIToken);
        const configuration: IExtensionHostConfigProvider = {
            getSnapshot: () => configService.getValue(),
            getWorkspaceFolders: () => {
                const root = explorer.getRootPath() ?? process.cwd();
                return [{ uri: Uri.file(root).toString(), name: path.basename(root), index: 0 }];
            },
            onDidChange: (cb) =>
                configService.onDidChangeConfiguration((event) => {
                    cb(event.affectedKeys);
                }),
        };

        // Сток диагностик расширений → MarkerService: потребители (squiggle в
        // редакторе, панель Problems) слушают onDidChangeMarkers и правок не требуют.
        const markerService = container.get(MarkerServiceDIToken);
        const diagnosticsSink = (owner: string, resource: string, markers: readonly WireMarker[]): void => {
            const data: IMarkerData[] = markers.map((m) => ({
                severity: toMarkerSeverity(m.severity),
                range: createRange(m.startLine, m.startCharacter, m.endLine, m.endCharacter),
                message: m.message,
                ...(m.code !== undefined ? { code: m.code } : {}),
                ...(m.source !== undefined ? { source: m.source } : {}),
            }));
            markerService.changeOne(owner, resource, data);
        };

        // Мосты декораций (Chunk 4): gutter change-bar'ы → редакторы группы,
        // файловые декорации → дерево, ThemeColor id → цвет активной темы.
        const editorDecorations = new EditorDecorationsServiceAdapter(group);
        const fileDecorations = new FileDecorationsServiceAdapter(explorer);
        const themeColorResolver = new ThemeColorResolverAdapter(container.get(ThemeServiceDIToken));

        const host = new ExtensionHost(adapter, commandAdapter, {
            logger,
            rpcLogger,
            stdoutLogger: wantStdio(stdoutLogger),
            stderrLogger: wantStdio(stderrLogger),
            configuration,
            editorDecorations,
            fileDecorations,
            themeColorResolver,
            activeDocumentProvider: () => activeDocumentSnapshot(group),
            diagnosticsSink,
            // withProgress расширений → запись статус-бара со спиннером.
            progressSink: new ProgressStatusBarAdapter(container.get(StatusBarServiceDIToken)),
            // createOutputChannel расширений → канал в панели Output;
            // show() открывает панель (как toggleOutputAction) и переключает канал.
            outputSink: new ExtensionOutputAdapter(
                container.get(OutputChannelRegistryDIToken),
                logService,
                container.get(OutputServiceDIToken),
                () => {
                    container.get(PanelServiceDIToken).setActiveView(OUTPUT_VIEW_ID);
                    container.get(LayoutServiceDIToken).setPanelVisible(true);
                },
            ),
        });

        // Провайдеры ФС расширений: схемы, объявленные субпроцессом (`git:` у
        // встроенного git), становятся читаемыми через реестр ядра. Адаптер сам
        // следит за появлением/исчезновением схем — расширение может
        // активироваться позже создания хоста.
        new FileSystemProviderAdapter(host, container.get(FileSystemProviderRegistryDIToken));

        // Save-pipeline: редакторы группы прогоняют will-save через host
        // (onWillSaveTextDocument), а состоявшееся сохранение уходит обратно
        // в subprocess (onDidSaveTextDocument).
        group.saveParticipant = (snapshot) => host.willSaveTextDocument(snapshot);
        group.onEditorSaved((meta) => {
            host.didSaveTextDocument(meta);
        });

        // Document sync (LSP): didOpen на смену активного редактора, didChange на
        // правку его содержимого — стоковый vscode-languageclient видит живой буфер.
        bindDocumentSync(group, host);

        // Completion: провайдеры расширений (languages.provideCompletionItems)
        // подключаются как источник автодополнений группы (читает CompletionService),
        // resolve — как источник описаний и правок авто-импорта выбранного пункта.
        group.completionSource = (req) => host.provideCompletionItems(req);
        group.completionResolver = (id) => host.resolveCompletionItem(id);
        // Триггер-символы объявляет сервер уже после активации — держим их
        // актуальными на каждом обновлении подписок субпроцесса.
        group.completionTriggerCharacters = host.completionTriggerCharacters;
        host.onCompletionTriggerCharactersChanged((characters) => {
            group.completionTriggerCharacters = characters;
        });

        // Definition: провайдеры расширений (languages.provideDefinition)
        // подключаются как источник целей Go to Definition (читает DefinitionService).
        group.definitionSource = (req) => host.provideDefinition(req);

        // Folding: провайдеры расширений (languages.provideFoldingRanges)
        // подключаются как источник областей сворачивания группы (читает
        // EditorComponent при пересчёте, мержит поверх indentation-фолдов).
        group.foldingRangeSource = (req) => host.provideFoldingRanges(req);
        // Когда folding-провайдер появляется (расширение активировалось после
        // открытия файла) — пере-подключаем источник, что триггерит пересчёт
        // фолдов уже открытых редакторов (иначе области не подъедут до правки).
        host.onFoldingProvidersChanged(() => {
            group.foldingRangeSource = (req) => host.provideFoldingRanges(req);
        });

        // Ленивая активация по `onLanguage:*`: при смене активного редактора
        // фаерим событие языка — host поднимает расширения, чьи activationEvents
        // содержат `onLanguage:<langId>` (напр. vexx-settings на JSON). Стартовое
        // событие для уже открытого редактора фаерит main.ts; ядро про
        // activation-events не знает — тот же seam-паттерн, что completionSource.
        group.onActiveEditorChanged((editor) => {
            if (editor !== null) void host.activateByEvent(`onLanguage:${editor.languageId}`);
        });

        return host;
    });
};
