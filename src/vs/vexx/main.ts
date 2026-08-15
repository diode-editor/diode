import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { HeadlessCaptureBackend } from "@tuidom/headless-backend/headlessCaptureBackend";
import { NodeTerminalBackend } from "@tuidom/terminal-backend/nodeTerminalBackend";
import { Size } from "@tuidom/core/common/geometryPromitives";
import { TuiApplication } from "@tuidom/core/dom/tuiApplication";
import { waitForIdle } from "@tuidom/inspector/idleWaiter";
import { attachInspector } from "@tuidom/inspector/index";
import type { InspectorDriver } from "@tuidom/inspector/InspectorDriver";
import { joinVirtualPath } from "../base/common/assets/assetBundleFormat.ts";
import { CompositeAssetAccess } from "../base/common/assets/compositeAssetAccess.ts";
import type { IAssetAccess } from "../base/common/assets/iAssetAccess.ts";
import { VEXX_VERSION } from "../base/common/version.ts";
import { createDefaultAssetAccess } from "../base/node/assets/createDefaultAssetAccess.ts";
import { FsAssetAccess } from "../base/node/assets/fsAssetAccess.ts";
import { isPackagedRuntime } from "../base/node/assets/packagedRuntime.ts";
import { isSeaBinary } from "../base/node/isSea.ts";
import type { ILanguageService } from "../editor/common/languages/iLanguageService.ts";
import { TokenizationRegistry } from "../editor/common/languages/tokenizationRegistry.ts";
import { OscClipboard } from "../platform/clipboard/common/oscClipboard.ts";
import { ConfigurationRegistry } from "../platform/configuration/common/configurationRegistry.ts";
import { loadConfiguration } from "../platform/configuration/node/configurationService.ts";
import type { ICliArgs } from "../platform/environment/node/cliArgs.ts";
import { CliArgsError, parseCliArgs, USAGE } from "../platform/environment/node/cliArgs.ts";
import { resolveUserDataPaths } from "../platform/environment/node/userDataPaths.ts";
import {
    installVsix,
    listInstalledExtensions,
    uninstallExtension,
} from "../platform/extensionManagement/node/extensionInstaller.ts";
import { scanExtensions } from "../platform/extensions/common/extensionScanner.ts";
import type {
    ICommandContribution,
    IConfigurationContribution,
} from "../platform/extensions/common/iExtensionManifest.ts";
import { mergeExtensions } from "../platform/extensions/common/mergeExtensions.ts";
import { ChokidarFileWatcher } from "../platform/files/node/chokidarFileWatcher.ts";
import { loadUserKeybindings } from "../platform/keybinding/node/keybindingsService.ts";
import type { ILogger } from "../platform/log/common/iLogger.ts";
import { LogService } from "../platform/log/common/logService.ts";
import { RingBufferSink } from "../platform/log/common/ringBufferSink.ts";
import { FileSink } from "../platform/log/node/fileSink.ts";
import { loadState } from "../platform/state/node/stateService.ts";
import { WorkbenchComponentDIToken } from "../workbench/browser/workbenchComponent.ts";
import { CONFIGURATION_CONTRIBUTIONS } from "../workbench/common/configuration/configurationContributions.ts";
import { TuiApplicationDIToken } from "../workbench/common/coreTokens.ts";
import { EditorServiceDIToken } from "../workbench/services/editor/browser/editorService.ts";
import { registerExtensionKeybindings } from "../workbench/services/extensions/common/extensionKeybindingContributor.ts";
import { ExtensionTokenizationContributor } from "../workbench/services/extensions/common/extensionTokenizationContributor.ts";
import { KeybindingRegistryDIToken } from "../platform/keybinding/common/keybindingRegistry.ts";
import { ExtensionHostDIToken } from "../workbench/services/extensions/node/extensionHost.ts";
import { runExtensionHostSubprocess } from "../workbench/services/extensions/node/extensionHostSubprocess.ts";
import { bundledTsServerTarget, ensureTsServer } from "../workbench/services/extensions/node/loadTsServer.ts";
import type { IExtensionRegistration } from "../workbench/services/extensions/node/iExtensionEntry.ts";
import { LanguageRegistry } from "../workbench/services/language/common/languageRegistry.ts";
import { createBuiltinThemeRegistry } from "../workbench/services/themes/common/themeRegistry.ts";
import { DEFAULT_COLOR_THEME } from "../workbench/services/themes/common/themes/builtinThemes.ts";
import { ThemeServiceDIToken } from "../workbench/services/themes/common/themeTokens.ts";
import { TokenThemeResolver } from "../workbench/services/themes/common/tokenThemeResolver.ts";

import { createProductionContainer } from "./modules/productionProfile.ts";
import { runAsNode } from "./runAsNode.ts";

// ── Subprocess branch ─────────────────────────────────────
// Если форкнул себя ExtensionHost'ом — уходим в subprocess entry до любых
// TUI/CLI инициализаций. Сигнал — env VEXX_EXTENSION_HOST=1, выставленный
// `ExtensionHost.ensureSubprocess()`.
//
// Node-режим проверяется РАНЬШЕ ext-host'а: language-сервер, запущенный нашим
// бинарём, не имеет IPC-канала (runExtensionHostSubprocess умер бы с exit 2),
// а env VEXX_EXTENSION_HOST может протечь от ext-host'а через spawn среды.

if (process.env.VEXX_RUN_AS_NODE === "1") {
    runAsNode();
} else if (process.env.VEXX_EXTENSION_HOST === "1") {
    runExtensionHostSubprocess();
    // runExtensionHostSubprocess() возвращается, но процесс остаётся живым
    // на IPC-канале до disconnect/shutdown. Просто не идём в TUI-ветку.
} else {
    await runEditor();
}

async function runEditor(): Promise<void> {
    // ── CLI ────────────────────────────────────────────────────

    let cli;
    try {
        cli = parseCliArgs(process.argv.slice(2));
    } catch (err) {
        if (err instanceof CliArgsError) {
            console.error(err.message);
            console.error(USAGE);
            process.exit(2);
        }
        throw err;
    }

    if (cli.version) {
        console.log(VEXX_VERSION);
        process.exit(0);
    }

    if (cli.help) {
        console.log(USAGE);
        process.exit(0);
    }

    // ── Управление расширениями ────────────────────────────────
    // Флаги --install/--uninstall/--list выполняются здесь и завершают процесс
    // до подъёма TUI (stdout ещё свободен). Приоритет install → uninstall → list.
    if (cli.installExtension !== undefined || cli.uninstallExtension !== undefined || cli.listExtensions) {
        await runExtensionManagement(cli);
        // runExtensionManagement всегда завершает процесс через process.exit.
    }

    const filePaths = cli.positional;
    if (filePaths.length === 0) {
        console.error("Usage: vexx <file> [file2] [file3] ...");
        console.error(USAGE);
        process.exit(1);
    }

    const resolvedPaths = filePaths.map((f) => path.resolve(f));

    // ── Logging ──────────────────────────────────────────────
    // Всегда поднимаем RingBufferSink (источник данных для будущей
    // Output-вкладки). FileSink — только в dev: пишем в ./vexx.log в cwd
    // с truncate при каждом запуске. Для агентов/разработчиков это удобный
    // debug-tool; в упакованных сборках файл вообще не создаётся — гейт идёт по
    // isPackagedRuntime(), а не isSeaBinary(): self-extract тоже прод, но не SEA.
    const logService = new LogService();
    // Буфер держим в переменной: он же — источник содержимого Output-панели,
    // и подключён до подъёма UI, иначе ранние каналы были бы потеряны.
    const logHistory = new RingBufferSink();
    logService.addSink(logHistory);
    if (!isPackagedRuntime()) {
        logService.addSink(new FileSink(path.resolve(process.cwd(), "vexx.log")));
    }
    const bootstrapLogger = logService.createLogger("bootstrap");
    const extensionsLogger = logService.createLogger("extensions");
    const configurationLogger = logService.createLogger("configuration");
    bootstrapLogger.info("vexx starting", { cwd: process.cwd(), files: filePaths.length });

    // ── User data: пути, настройки ─────────────────────────────

    const userDataPaths = resolveUserDataPaths({
        userDataDir: cli.userDataDir,
        profile: cli.profile,
        homedir: os.homedir(),
    });
    // Live-reload настроек: следим за settings.json, чтобы правки применялись без
    // рестарта. Отдельный экземпляр watcher'а (редакторные контроллеры получают свой
    // через FileWatcherModule — следят за другими файлами). Живёт всё время работы
    // приложения; fd освобождается ОС на выходе, как и у editor-watcher'ов.
    const settingsWatcher = new ChokidarFileWatcher();
    // Реестр схем настроек: defaults-слой конфигурации и известные ключи для
    // валидации settings.json собираются из configuration-узлов фич.
    const configurationRegistry = new ConfigurationRegistry(CONFIGURATION_CONTRIBUTIONS);
    const configurationService = await loadConfiguration(
        userDataPaths,
        configurationLogger,
        settingsWatcher,
        configurationRegistry,
    );
    const userKeybindings = await loadUserKeybindings(userDataPaths.keybindingsFile, configurationLogger);
    // Машинное состояние UI/сессии (открытые файлы, layout) — отдельно от настроек.
    const stateService = loadState(userDataPaths, configurationLogger);

    // ── Backend / Theme ────────────────────────────────────────

    // Headless: рендер в память + управление через инспектор, без реального
    // терминала. Иначе — обычный stdin/stdout-бэкенд.
    const headlessBackend = cli.headless
        ? new HeadlessCaptureBackend(new Size(cli.headless.cols, cli.headless.rows))
        : null;
    const backend = headlessBackend ?? new NodeTerminalBackend();
    const application = new TuiApplication(backend);
    // Опциональная самопроверка дерева после каждого кадра (дорогая только
    // относительно, но включается явно): ловит полуприкреплённые элементы.
    application.validateTreeAfterRender = process.env.VEXX_VALIDATE_TREE === "1";
    const clipboard = new OscClipboard((seq) => {
        backend.writeOscSequence(seq);
    });

    // Реестр встроенных тем + выбор активной по `workbench.colorTheme`. Неизвестное
    // имя (тема из ещё не установленного расширения, опечатка) — откат на дефолт.
    const themeRegistry = createBuiltinThemeRegistry();
    const colorThemeLabel = configurationService.get<string>("workbench.colorTheme") ?? DEFAULT_COLOR_THEME;
    const initialTheme =
        themeRegistry.resolve(colorThemeLabel) ?? themeRegistry.resolve(DEFAULT_COLOR_THEME) ?? undefined;
    if (initialTheme === undefined) {
        throw new Error(`No built-in theme available (looked up "${colorThemeLabel}" and "${DEFAULT_COLOR_THEME}")`);
    }

    // ── Загрузка расширений ────────────────────────────────────
    // Builtin: либо SEA-bundle, либо `src/Extensions/builtin/` в dev.
    // User: `<userData.root>/extensions/` через `FsAssetAccess`, замапленный
    // на виртуальный префикс `UserExtensions/`. Оба источника склеиваются в
    // один `IAssetAccess` через `CompositeAssetAccess`, чтобы все downstream
    // потребители (`ExtensionTokenizationContributor`, грамматики и т.д.)
    // видели единое адресное пространство.

    const BUILTIN_PREFIX = "Extensions/builtin/";
    const USER_PREFIX = "UserExtensions/";

    const builtinAssets = createDefaultAssetAccess();
    const userExtensionsAssets: IAssetAccess = new FsAssetAccess({
        [USER_PREFIX]: userDataPaths.extensionsDir,
    });
    const assets = new CompositeAssetAccess({
        "": builtinAssets,
        [USER_PREFIX]: userExtensionsAssets,
    });

    const builtinExtensions = await scanExtensions(assets, BUILTIN_PREFIX, { isBuiltin: true }, extensionsLogger);
    const userExtensions = fs.existsSync(userDataPaths.extensionsDir)
        ? await scanExtensions(assets, USER_PREFIX, { isBuiltin: false }, extensionsLogger)
        : [];
    const allExtensions = mergeExtensions(builtinExtensions, userExtensions, extensionsLogger);

    const languageRegistry = new LanguageRegistry();
    for (const ext of allExtensions) languageRegistry.register(ext);

    const tokenizationRegistry = new TokenizationRegistry();
    const tokenizationContributor = new ExtensionTokenizationContributor(
        assets,
        allExtensions,
        tokenizationRegistry,
        extensionsLogger,
    );
    // Только регистрация ленивых фабрик — грамматики парсятся по требованию.
    tokenizationContributor.apply();

    // ── Bootstrap через DI-контейнер ────────────────────────────
    const tokenStyleResolver = new TokenThemeResolver(initialTheme.tokenTheme);

    const container = createProductionContainer({
        app: application,
        backend,
        theme: initialTheme,
        themeRegistry,
        clipboard,
        tokenizationRegistry,
        tokenStyleResolver,
        languageService: languageRegistry,
        configurationService,
        configurationRegistry,
        stateService,
        userKeybindings,
        logService,
        logHistory,
        settingsResource: userDataPaths.settingsFile,
        keybindingsResource: userDataPaths.keybindingsFile,
    });

    // Единственный якорь сброса состояния на диск: `process.exit(0)` (любой путь
    // выхода — quit, SIGINT в NodeTerminalBackend) фаерит "exit". Только синхронный
    // I/O — поэтому flushSync. Write-through держит in-memory стор актуальным, так
    // что здесь всегда сериализуется последнее состояние.
    process.on("exit", () => {
        try {
            stateService.flushSync();
        } catch {
            /* на выходе делать нечего — глотаем */
        }
    });

    // Смена цветовой темы должна перекрашивать и синтаксис: пересаживаем token-тему
    // в резолвер скоупов. Редакторы сами перерисовываются по своему
    // `ThemeService.onThemeChange` (deferred render), поэтому достаточно синхронно
    // обновить резолвер в этом же broadcast'е.
    container.get(ThemeServiceDIToken).onThemeChange((theme) => {
        tokenStyleResolver.setTheme(theme.tokenTheme);
    });

    const app = container.get(TuiApplicationDIToken);
    const workbench = container.get(WorkbenchComponentDIToken);
    // Поднимаем extension host. Регистрация расширений с `manifest.main` (builtin +
    // user) — ниже, ПОСЛЕ setWorkspaceFolder + openFile (чтобы workspaceFolders и
    // activeTextEditor были доступны на момент `activate()`).
    const extensionHost = container.get(ExtensionHostDIToken);

    // `contributes.keybindings` расширений — регистрируем ПОСЛЕ builtin-биндингов
    // (они заведены при построении WorkbenchComponent), чтобы расширение могло
    // переопределить встроенный аккорд. Декларативно, без extension host'а.
    registerExtensionKeybindings(
        allExtensions,
        container.get(KeybindingRegistryDIToken),
        process.platform,
        extensionsLogger,
    );

    // If the first argument is a directory, use it as the workspace folder
    const firstResolved = resolvedPaths[0];
    if (fs.statSync(firstResolved, { throwIfNoEntry: false })?.isDirectory()) {
        workbench.setWorkspaceFolder(firstResolved);
    }

    app.root = workbench.view;
    workbench.mount();
    app.run();

    // TUIDom-инспектор: поднимаем WebSocket-сервер только по `--inspect-tui`.
    // Сервер читает дерево лениво (на момент getDocument), поэтому ок поднять
    // его до openFile — клиент увидит актуальное дерево, когда подключится.
    // Логируем порт только в logService: писать в stderr нельзя — он уходит в
    // тот же pty и испортит TUI-рендер.
    if (cli.inspectTui !== undefined) {
        // В headless-режиме инспектор получает driver: инъекция ввода + захват
        // кадра. В обычном режиме driver нет — инспектор остаётся read-only.
        const driver: InspectorDriver | undefined =
            headlessBackend === null
                ? undefined
                : {
                      sendKey: (name) => {
                          headlessBackend.sendKey(name);
                      },
                      sendText: (text) => {
                          headlessBackend.sendPaste(text);
                      },
                      sendMouse: (params) => {
                          // Протокол говорит в 0-based экранных ячейках (как box узла),
                          // терминальные последовательности — в 1-based.
                          headlessBackend.sendMouse({ ...params, x: params.x + 1, y: params.y + 1 });
                      },
                      resize: (cols, rows) => {
                          headlessBackend.resize(new Size(cols, rows));
                      },
                      captureFrame: async () => {
                          // Слить кадр, отложенный на setImmediate (scheduleRender),
                          // прежде чем снять снимок.
                          await new Promise<void>((resolve) => setImmediate(resolve));
                          return headlessBackend.captureFrame();
                      },
                      waitForIdle: (params) =>
                          // «Рендер устоялся»: считаем кадры приложения, а не гадаем sleep.
                          waitForIdle(
                              { frameCount: () => app.frameCount, isRenderScheduled: () => app.isRenderScheduled },
                              params,
                          ),
                      shutdown: () => {
                          // Отложенно, чтобы RPC-ответ успел уйти до выхода.
                          setImmediate(() => {
                              try {
                                  extensionHost.dispose();
                              } finally {
                                  process.exit(0);
                              }
                          });
                      },
                  };
        const inspector = await attachInspector(app, cli.inspectTui, driver);
        bootstrapLogger.info("TUIDom inspector listening", {
            host: cli.inspectTui.host,
            port: inspector.port,
            headless: headlessBackend !== null,
        });
    }

    await workbench.activate();
    const explicitFiles = resolvedPaths.filter((p) => !fs.statSync(p, { throwIfNoEntry: false })?.isDirectory());
    // Явные файлы в CLI перебивают сохранённую сессию (как `code file.ts`).
    const startupFiles = explicitFiles.length > 0 ? explicitFiles : workbench.getOpenEditorsToRestore();
    // Грамматики стартовых файлов ждём ДО открытия — иначе первый кадр вкладки
    // покажет неподсвеченный текст, а цвета доедут репейнтом. Ждём именно те
    // языки, что открываются (обычно один, ~2 мс), а не все 77 грамматик (~420 мс);
    // остальные догоняет фоновый preloadAll ниже. После openFile ждать поздно:
    // await отдаёт event loop, и отложенный рендер успевает нарисовать кадр.
    await preloadGrammarsForFiles(startupFiles, languageRegistry, tokenizationRegistry);
    if (explicitFiles.length > 0) {
        for (const p of explicitFiles) workbench.openFile(p);
    } else {
        // Иначе восстанавливаем открытые файлы прошлой сессии этого воркспейса.
        workbench.restoreOpenEditors();
    }
    workbench.focusEditor();

    // Регистрируем пользовательские расширения с `manifest.main` в extension host.
    // `registerExtension` — только bookkeeping (subprocess не поднимается);
    // реальная активация — событийная (`activateByEvent` ниже) по `activationEvents`.
    // Регистрируем ПОСЛЕ openFile, чтобы к моменту стартовых событий activeTextEditor
    // был доступен на `activate()`.
    for (const ext of userExtensions) {
        if (typeof ext.manifest.main !== "string" || ext.manifest.main === "") continue;
        const dirName = ext.location.slice(USER_PREFIX.length).replace(/\/$/, "");
        const mainPath = path.resolve(userDataPaths.extensionsDir, dirName, ext.manifest.main);
        try {
            const reg: IExtensionRegistration = {
                id: ext.id,
                manifest: {
                    name: ext.manifest.name,
                    publisher: ext.manifest.publisher,
                    version: ext.manifest.version,
                },
                mainPath,
                configDefaults: flattenConfigDefaults(ext.manifest.contributes?.configuration),
                commandTitles: collectCommandTitles(ext.manifest.contributes?.commands),
                activationEvents: ext.manifest.activationEvents,
            };
            extensionHost.registerExtension(reg);
        } catch (err) {
            extensionsLogger.error(`${ext.id}: failed to register`, err);
        }
    }

    // Регистрируем builtin code-расширения (например встроенный `git`): их
    // скомпилированный `out/extension.cjs` читаем из `assets` (dev — FsAssetAccess,
    // SEA — BundleAssetAccess, единый вызов) и грузим строкой-исходником, которую
    // subprocess компилирует в памяти через Module._compile — без записи на диск.
    for (const ext of builtinExtensions) {
        const main = ext.manifest.main;
        if (typeof main !== "string" || main === "") continue;
        try {
            const virtualPath = joinVirtualPath(ext.location, main);
            const source = await assets.readText(virtualPath);
            const reg: IExtensionRegistration = {
                id: ext.id,
                manifest: {
                    name: ext.manifest.name,
                    publisher: ext.manifest.publisher,
                    version: ext.manifest.version,
                },
                source,
                // Синтетический абсолютный путь-идентичность (реального файла под SEA нет).
                filename: `/${virtualPath}`,
                configDefaults: {
                    ...flattenConfigDefaults(ext.manifest.contributes?.configuration),
                    ...builtinConfigInjection(ext.manifest.name, extensionsLogger),
                },
                commandTitles: collectCommandTitles(ext.manifest.contributes?.commands),
                activationEvents: ext.manifest.activationEvents,
            };
            extensionHost.registerExtension(reg);
        } catch (err) {
            extensionsLogger.error(`${ext.id}: failed to register (builtin)`, err);
        }
    }

    // Фаерим стартовые события активации. Порядок: eager `*` → `onLanguage:*` для
    // языка уже открытого активного редактора → `onStartupFinished`. Последующие
    // `onLanguage:*` (переключение/открытие вкладок) фаерит ExtensionHostModule
    // через `EditorService.onActiveEditorChanged`. Расширения без
    // `activationEvents` трактуются как `["*"]` — активируются здесь же.
    // Per-extension сбои activate() изолирует сам ExtensionHost (log + continue);
    // здесь ловим host-level сбой (subprocess не поднялся) — редактор не должен
    // падать из-за нерабочего extension host'а, просто без расширений.
    try {
        await extensionHost.activateByEvent("*");
        const activeLanguageId = container.get(EditorServiceDIToken).getActiveEditor()?.languageId;
        if (activeLanguageId !== undefined) {
            await extensionHost.activateByEvent(`onLanguage:${activeLanguageId}`);
        }
        await extensionHost.activateByEvent("onStartupFinished");
    } catch (err) {
        extensionsLogger.error("extension host activation failed", err);
    }

    // Остальные грамматики догружаем в фоне, чтобы переключение вкладки на другой
    // язык не ждало парсинга. setImmediate — уже после первого кадра и спавна
    // extension host'а, так что с критическим путём старта прогрев не конкурирует.
    // Здесь же — фаза Eventually workbench-contributions (idle после первого кадра).
    setImmediate(() => {
        workbench.runEventuallyPhase();
        void tokenizationContributor.preloadAll();
    });
}

/**
 * Выполняет CLI-команду управления расширениями (--install/--uninstall/--list)
 * и завершает процесс. Работает по каталогу `<userData>/extensions` без подъёма
 * TUI; вывод — в stdout/stderr, коды выхода 0 (успех) / 1 (ошибка).
 */
async function runExtensionManagement(cli: ICliArgs): Promise<never> {
    const { extensionsDir } = resolveUserDataPaths({
        userDataDir: cli.userDataDir,
        profile: cli.profile,
        homedir: os.homedir(),
    });

    try {
        if (cli.installExtension !== undefined) {
            const vsixPath = path.resolve(cli.installExtension);
            const { id, version, previous } = await installVsix(vsixPath, extensionsDir);
            console.log(`Installed ${id}@${version}`);
            const removed = previous.filter((v) => v !== version);
            if (removed.length > 0) {
                console.log(`Removed previous version(s): ${removed.join(", ")}`);
            }
            process.exit(0);
        }

        if (cli.uninstallExtension !== undefined) {
            const id = cli.uninstallExtension;
            const { removed } = uninstallExtension(id, extensionsDir);
            if (removed.length === 0) {
                console.error(`Extension ${id} is not installed`);
                process.exit(1);
            }
            console.log(`Uninstalled ${id} (${removed.length} version(s))`);
            process.exit(0);
        }

        // --list-extensions
        for (const ext of listInstalledExtensions(extensionsDir)) {
            console.log(`${ext.id}@${ext.version}`);
        }
        process.exit(0);
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
}

/**
 * Ждёт грамматики языков, на которых написаны `files`. Вызывать до открытия
 * этих файлов: иначе первый кадр вкладки выйдет на fallback-токенайзере, а
 * подсветка догонит репейнтом.
 *
 * Языки дедуплицируются (десять `.ts`-вкладок — одна грамматика), неизвестные
 * расширения отсеиваются. Загрузки идут параллельно: их единицы, и это не
 * фоновый прогрев, а критический путь. `load()` не реджектится — сбойная
 * грамматика просто оставит язык на fallback'е, стартовать это не помешает.
 */
async function preloadGrammarsForFiles(
    files: readonly string[],
    languageService: ILanguageService,
    tokenizationRegistry: TokenizationRegistry,
): Promise<void> {
    const languageIds = new Set<string>();
    for (const file of files) {
        const languageId = languageService.getLanguageIdForResource(file);
        if (languageId !== undefined) languageIds.add(languageId);
    }
    await Promise.all([...languageIds].map((languageId) => tokenizationRegistry.load(languageId)));
}

/**
 * Сплющивает `contributes.configuration` расширения в dotted-map дефолтов
 * (`{ "editorconfig.generateAuto": true }`). Ключи `properties` — уже полные
 * dotted-пути настроек. Блок может быть объектом или массивом объектов.
 */
/**
 * Синтетические config-дефолты host'а для builtin-расширений (в манифесте их
 * нет — это внутренний seam, не пользовательские настройки).
 *
 * Для `vexx-lsp-typescript` — вшитый language-сервер: целевые пути распаковки
 * (детерминированы от версии+хэша бандла — их можно раздать ДО распаковки;
 * готовность клиент проверяет existsSync самого entry, публикация атомарна)
 * и режим node-рантайма. Сама распаковка стартует здесь же fire-and-forget —
 * после первого кадра, вне перцептивно-критического пути (VISION).
 */
function builtinConfigInjection(manifestName: string, logger: ILogger): Record<string, unknown> {
    if (manifestName !== "vexx-lsp-typescript") return {};
    const target = bundledTsServerTarget();
    if (target === null) return {};
    void ensureTsServer((err) => {
        logger.error("bundled ts-server unpack failed", err);
    });
    return {
        "vexx.lsp.typescript.bundledServerPath": target.serverPath,
        "vexx.lsp.typescript.bundledTsserverPath": target.tsserverPath,
        // SEA: сервер запускается нашим же бинарём в node-режиме (runAsNode.ts);
        // dev/self-extract: process.execPath субпроцесса — настоящий node.
        "vexx.lsp.typescript.serverRuntime": isSeaBinary() ? "vexx-as-node" : "node",
    };
}

function flattenConfigDefaults(
    configuration: IConfigurationContribution | readonly IConfigurationContribution[] | undefined,
): Record<string, unknown> | undefined {
    if (configuration === undefined) return undefined;
    const blocks = Array.isArray(configuration) ? configuration : [configuration];
    const defaults: Record<string, unknown> = {};
    for (const block of blocks as readonly IConfigurationContribution[]) {
        const properties = block.properties;
        if (properties === undefined) continue;
        for (const [key, schema] of Object.entries(properties) as [string, unknown][]) {
            if (schema !== null && typeof schema === "object" && "default" in schema) {
                defaults[key] = schema.default;
            }
        }
    }
    return Object.keys(defaults).length > 0 ? defaults : undefined;
}

/**
 * Собирает `contributes.commands` в map id → title, чтобы host завёл прокси
 * рантайм-команд с заголовком (иначе команда исполнима, но не видна в палитре).
 */
function collectCommandTitles(
    commands: readonly ICommandContribution[] | undefined,
): Record<string, string> | undefined {
    if (commands === undefined || commands.length === 0) return undefined;
    const titles: Record<string, string> = {};
    for (const cmd of commands) {
        if (typeof cmd.command === "string" && typeof cmd.title === "string") {
            titles[cmd.command] = cmd.title;
        }
    }
    return Object.keys(titles).length > 0 ? titles : undefined;
}
