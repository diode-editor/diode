import * as fs from "node:fs";
import { createTestEditorContextMenuController } from "./testEditorContextMenu.ts";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { IDisposable } from "../../tuidom/common/disposable.ts";
import type { ILanguageService } from "../vs/editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../vs/editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../vs/editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../vs/editor/common/languages/tokenizationRegistry.ts";
import { CommandRegistry } from "../vs/platform/commands/common/commandRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../vs/platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../vs/platform/files/common/iFileWatcher.ts";
import { UndoRedoService } from "../vs/platform/undoRedo/common/undoRedoService.ts";
import { CommandServiceAdapter } from "../vs/workbench/api/browser/commandServiceAdapter.ts";
import { EditorOptionsServiceAdapter } from "../vs/workbench/api/browser/editorOptionsServiceAdapter.ts";
import type { IEditorDecorationsService } from "../vs/workbench/api/common/iEditorDecorationsService.ts";
import type { IFileDecorationsService } from "../vs/workbench/api/common/iFileDecorationsService.ts";
import type { IThemeColorResolver } from "../vs/workbench/api/common/iThemeColorResolver.ts";
import { EditorGroupComponent } from "../vs/workbench/browser/parts/editor/editorGroupComponent.ts";
import { EditorService } from "../vs/workbench/services/editor/browser/editorService.ts";
import {
    ExtensionHost,
    type IExtensionHostConfigProvider,
} from "../vs/workbench/services/extensions/node/extensionHost.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";

const SUBPROCESS_ENTRY = fileURLToPath(
    new URL("../vs/workbench/services/extensions/node/__fixtures__/subprocessEntry.ts", import.meta.url),
);

/**
 * Возвращает `spawnArgs`-фабрику для тестового запуска subprocess'а — вместо
 * `main.ts` запускает {@link SUBPROCESS_ENTRY} через `tsx` loader. Это нужно,
 * т.к. в vitest `process.argv[1]` указывает на vitest CLI, а не на `main.ts`.
 */
export function subprocessSpawnArgsForTests(): () => { command: string; args: string[]; env?: NodeJS.ProcessEnv } {
    return () => ({
        command: process.execPath,
        // Полный `tsx` (не `tsx/esm`) регистрирует и ESM-, и CJS-хук: расширения
        // грузятся через `createRequire(mainPath)`, поэтому `.ts`-main (напр.
        // builtin `git`) требует CJS-транспиляции. `.cjs`-фикстуры работают как есть.
        args: ["--import", "tsx", SUBPROCESS_ENTRY],
        env: { ...process.env },
    });
}

/** Абсолютный путь к `src/Extensions/Host/__fixtures__` с тестовыми `.cjs`-расширениями. */
export const EXTENSION_FIXTURES_DIR = path.dirname(SUBPROCESS_ENTRY);

/**
 * Регистрация fixture-расширения из {@link EXTENSION_FIXTURES_DIR} с минимальным
 * тестовым манифестом (`publisher: "test"`). Расширяемые поля (`commandTitles`,
 * `configDefaults`) добавляются спредом: `{ ...extensionFixture(...), commandTitles }`.
 */
export function extensionFixture(id: string, file: string): IExtensionRegistration {
    return {
        id,
        manifest: { name: id, publisher: "test", version: "0.0.1" },
        mainPath: path.join(EXTENSION_FIXTURES_DIR, file),
    };
}

/**
 * Тест-хелпер: регистрирует расширение и сразу активирует его через
 * `activateByEvent("*")` (reg без `activationEvents` нормализуется в `["*"]`).
 * Заменяет прежний eager `await host.registerExtension(reg)` в тестах, которым
 * важно, что расширение активно сразу. Возвращает disposable от регистрации.
 */
export async function registerAndActivate(host: ExtensionHost, reg: IExtensionRegistration): Promise<IDisposable> {
    const disposable = host.registerExtension(reg);
    await host.activateByEvent("*");
    return disposable;
}
import { WorkbenchTheme } from "../vs/platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../vs/workbench/services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../vs/workbench/services/themes/common/themeService.ts";

import { TestApp } from "./TestApp.ts";

export interface IExtensionHarnessOptions {
    readonly initialFile?: { readonly name: string; readonly content: string };
    readonly extensions?: readonly IExtensionRegistration[];
    /**
     * Событие(я) активации, которые харнесс фаерит после регистрации расширений.
     * По умолчанию — `["*"]` (eager, эквивалент прежнего поведения). Тесты
     * ленивой активации передают собственный набор (или `[]`, чтобы драйвить
     * `harness.host.activateByEvent(...)` вручную).
     */
    readonly activateEvents?: readonly string[];
    /**
     * Снапшот конфигурации, который host запушит в subprocess
     * (`workspace.initialize`). Читается расширением через `getConfiguration`.
     */
    readonly configuration?: unknown;
    /**
     * Пути папок воркспейса (`workspace.workspaceFolders`). По умолчанию — tmpDir.
     */
    readonly workspaceFolders?: readonly string[];
    /**
     * Сервис определения языка (для `document.languageId`). По умолчанию —
     * {@link NULL_LANGUAGE_SERVICE} (всё — `plaintext`).
     */
    readonly languageService?: ILanguageService;
    /** Мост gutter-декораций к редакторам (Chunk 4). По умолчанию не подключён. */
    readonly editorDecorations?: IEditorDecorationsService;
    /** Мост файловых декораций к дереву (Chunk 4). По умолчанию не подключён. */
    readonly fileDecorations?: IFileDecorationsService;
    /** Резолвер ThemeColor id → packed-RGB (+ смена темы). По умолчанию не подключён. */
    readonly themeColorResolver?: IThemeColorResolver;
}

export interface IExtensionHarness {
    readonly app: TestApp;
    readonly host: ExtensionHost;
    readonly group: EditorService;
    /** ThemeService, за которым стоит харнесс (для тестов смены темы). */
    readonly themeService: ThemeService;
    /**
     * Host-реестр команд, за которым стоит {@link ExtensionHost}. Тест может
     * `execute(...)` прокси-команду сабпроцесса (host → subprocess) или
     * `register(...)` хостовую команду, которую сабпроцесс вызовет fall-through.
     */
    readonly commandRegistry: CommandRegistry;
    readonly tmpDir: string;
    writeFile(name: string, content: string): string;
    /**
     * Прокачивает microtask-очередь — RPC в Phase 1 идёт через `queueMicrotask`,
     * один полный round-trip = два «оборота» (request → handler → response).
     */
    flushRpc(turns?: number): Promise<void>;
    dispose(): Promise<void>;
}

/**
 * Test harness для расширений: поднимает реальный {@link EditorService} (плюс
 * {@link EditorGroupComponent} как view группы) + {@link ExtensionHost},
 * оборачивает в {@link TestApp} (через body вокруг view группы), опционально
 * открывает файл и регистрирует расширения.
 *
 * Расширения регистрируются (bookkeeping), затем харнесс фаерит события
 * активации (`activateEvents`, по умолчанию `["*"]`) — каждое `activateByEvent`
 * ждёт завершения `activate()` и RPC-вызовов внутри него.
 */
export async function createExtensionTestHarness(options: IExtensionHarnessOptions = {}): Promise<IExtensionHarness> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vexx-ext-"));

    const themeService = new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme));
    const group = new EditorService(
        themeService,
        new TokenizationRegistry(),
        NULL_TOKEN_STYLE_RESOLVER,
        options.languageService ?? NULL_LANGUAGE_SERVICE,
        NULL_CONFIGURATION_SERVICE,
        new UndoRedoService(),
        NULL_FILE_WATCHER,
        createTestEditorContextMenuController(),
    );
    const groupComponent = new EditorGroupComponent(group, themeService);

    const adapter = new EditorOptionsServiceAdapter(group);
    const commandRegistry = new CommandRegistry();
    const commandAdapter = new CommandServiceAdapter(commandRegistry);
    const folders = (options.workspaceFolders ?? [tmpDir]).map((p, index) => ({
        uri: p,
        name: path.basename(p),
        index,
    }));
    const configuration: IExtensionHostConfigProvider = {
        getSnapshot: () => options.configuration,
        getWorkspaceFolders: () => folders,
        onDidChange: () => ({ dispose: () => undefined }),
    };
    const host = new ExtensionHost(adapter, commandAdapter, {
        spawnArgs: subprocessSpawnArgsForTests(),
        configuration,
        ...(options.editorDecorations !== undefined ? { editorDecorations: options.editorDecorations } : {}),
        ...(options.fileDecorations !== undefined ? { fileDecorations: options.fileDecorations } : {}),
        ...(options.themeColorResolver !== undefined ? { themeColorResolver: options.themeColorResolver } : {}),
    });

    // Save-pipeline (WP6): проброс will-save/did-save между группой и хостом.
    group.saveParticipant = (snapshot) => host.willSaveTextDocument(snapshot);
    group.onEditorSaved((meta) => {
        host.didSaveTextDocument(meta);
    });
    // Completion (WP8): источник автодополнений — провайдеры расширений через host.
    group.completionSource = (req) => host.provideCompletionItems(req);
    // Folding (#87): источник областей сворачивания — провайдеры расширений через host.
    group.foldingRangeSource = (req) => host.provideFoldingRanges(req);
    host.onFoldingProvidersChanged(() => {
        group.foldingRangeSource = (req) => host.provideFoldingRanges(req);
    });

    const writeFile = (name: string, content: string): string => {
        const fp = path.join(tmpDir, name);
        fs.writeFileSync(fp, content, "utf-8");
        return fp;
    };

    if (options.initialFile !== undefined) {
        const fp = writeFile(options.initialFile.name, options.initialFile.content);
        group.openFile(fp);
    }

    const app = TestApp.createWithContent(groupComponent.view);

    const flushRpc = async (turns = 2): Promise<void> => {
        for (let i = 0; i < turns; i++) {
            await new Promise<void>((resolve) => {
                queueMicrotask(resolve);
            });
        }
    };

    for (const reg of options.extensions ?? []) {
        host.registerExtension(reg);
    }
    // Активация теперь событийная: фаерим согласованные события (по умолчанию
    // `*` — eager, как раньше). Последовательно — каждый activateByEvent ждёт
    // завершения activate() и внутренних RPC.
    for (const event of options.activateEvents ?? ["*"]) {
        await host.activateByEvent(event);
    }

    const dispose = async (): Promise<void> => {
        host.dispose();
        // ExtensionHost.dispose стартует асинхронный shutdownSubprocess(); ждём
        // короткое окно, чтобы дать ему успеть отправить host.shutdown и
        // дочерний процесс корректно завершился.
        await new Promise((resolve) => setTimeout(resolve, 100));
        groupComponent.dispose();
        group.dispose();
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    };

    return { app, host, group, themeService, commandRegistry, tmpDir, writeFile, flushRpc, dispose };
}
