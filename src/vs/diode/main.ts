import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { TuiApplication } from "@tuidom/core/dom/tuiApplication";
import { HeadlessCaptureBackend } from "@tuidom/headless-backend/headlessCaptureBackend";
import { waitForIdle } from "@tuidom/inspector/idleWaiter";
import { attachInspector } from "@tuidom/inspector/index";
import type { InspectorDriver } from "@tuidom/inspector/InspectorDriver";
import { NodeTerminalBackend } from "@tuidom/terminal-backend/nodeTerminalBackend";

import { CompositeAssetAccess } from "../base/common/assets/compositeAssetAccess.ts";
import type { IAssetAccess } from "../base/common/assets/iAssetAccess.ts";
import { describeRejection } from "../base/common/describeRejection.ts";
import { mark } from "../base/common/performance.ts";
import { DIODE_VERSION } from "../base/common/version.ts";
import { createDefaultAssetAccess } from "../base/node/assets/createDefaultAssetAccess.ts";
import { FsAssetAccess } from "../base/node/assets/fsAssetAccess.ts";
import { isPackagedRuntime } from "../base/node/assets/packagedRuntime.ts";
import { isSeaBinary } from "../base/node/isSea.ts";
import { currentProcessSnapshot, realRestartHooks, restartProcess } from "../base/node/restartProcess.ts";
import type { ILanguageService } from "../editor/common/languages/iLanguageService.ts";
import { TokenizationRegistry } from "../editor/common/languages/tokenizationRegistry.ts";
import { OscClipboard } from "../platform/clipboard/common/oscClipboard.ts";
import { ConfigurationRegistry } from "../platform/configuration/common/configurationRegistry.ts";
import { loadConfiguration } from "../platform/configuration/node/configurationService.ts";
import type { ICliArgs } from "../platform/environment/node/cliArgs.ts";
import { CliArgsError, parseCliArgs, USAGE } from "../platform/environment/node/cliArgs.ts";
import type { IStartupTargets } from "../platform/environment/node/startupTargets.ts";
import { resolveStartupTargets } from "../platform/environment/node/startupTargets.ts";
import type { IUserDataPaths } from "../platform/environment/node/userDataPaths.ts";
import { resolveUserDataPaths } from "../platform/environment/node/userDataPaths.ts";
import { createRegistrySource } from "../platform/extensionManagement/node/createRegistrySource.ts";
import {
    installVsix,
    listInstalledExtensions,
    uninstallExtension,
} from "../platform/extensionManagement/node/extensionInstaller.ts";
import { installFromRegistry } from "../platform/extensionManagement/node/installFromRegistry.ts";
import { currentTargetPlatform } from "../platform/extensionManagement/node/targetPlatform.ts";
import { scanExtensions } from "../platform/extensions/common/extensionScanner.ts";
import { mergeExtensions } from "../platform/extensions/common/mergeExtensions.ts";
import { ChokidarFileWatcher } from "../platform/files/node/chokidarFileWatcher.ts";
import { runTreeWatcherSubprocess } from "../platform/files/node/treeWatcherMain.ts";
import { loadUserKeybindings } from "../platform/keybinding/node/keybindingsService.ts";
import { TuiApplicationDIToken } from "../platform/layout/browser/tuiApplicationDIToken.ts";
import type { ILogger } from "../platform/log/common/iLogger.ts";
import { LogService } from "../platform/log/common/logService.ts";
import { RingBufferSink } from "../platform/log/common/ringBufferSink.ts";
import { FileSink } from "../platform/log/node/fileSink.ts";
import { loadState } from "../platform/state/node/stateService.ts";
import { VSCODE_SHIM_VERSION } from "../workbench/api/common/vscodeShimVersion.ts";
import { WorkbenchComponentDIToken } from "../workbench/browser/workbenchComponent.ts";
import { CONFIGURATION_CONTRIBUTIONS } from "../workbench/common/configuration/configurationContributions.ts";
import { ExtensionServiceDIToken } from "../workbench/services/extensions/common/extensions.ts";
import { ExtensionThemeContributor } from "../workbench/services/extensions/common/extensionThemeContributor.ts";
import { ExtensionTokenizationContributor } from "../workbench/services/extensions/common/extensionTokenizationContributor.ts";
import { runExtensionHostSubprocess } from "../workbench/services/extensions/node/extensionHostSubprocess.ts";
import { bundledTsServerTarget, ensureTsServer } from "../workbench/services/extensions/node/loadTsServer.ts";
import { LanguageConfigurationService } from "../workbench/services/language/common/languageConfigurationService.ts";
import { LanguageRegistry } from "../workbench/services/language/common/languageRegistry.ts";
import { LifecycleServiceDIToken } from "../workbench/services/lifecycle/browser/lifecycleService.ts";
import { createBuiltinThemeRegistry } from "../workbench/services/themes/common/themeRegistry.ts";
import { DEFAULT_COLOR_THEME } from "../workbench/services/themes/common/themes/builtinThemes.ts";
import { ThemeServiceDIToken } from "../workbench/services/themes/common/themeTokens.ts";
import { TokenThemeResolver } from "../workbench/services/themes/common/tokenThemeResolver.ts";

import { curatedConfigInjection } from "./curatedConfigInjection.ts";
import { createProductionContainer } from "./modules/productionProfile.ts";
import { runAsNode } from "./runAsNode.ts";
import { setupStartupTrace, TracingNodeTerminalBackend, writeStartupTrace } from "./startupTrace.ts";
import { startWorkbench } from "./workbenchStartup.ts";

// ── Subprocess branch ─────────────────────────────────────
// Если нас запустили не редактором, а в служебной роли, уходим в её entry до
// любых TUI/CLI инициализаций. Роль выбирает env-флаг спавнящей стороны; форком
// самого себя редактор поднимает две: DIODE_EXTENSION_HOST=1
// (`ExtensionHost.ensureSubprocess()`) и DIODE_FILE_WATCHER=1
// (`SubprocessTreeWatcher`, обход дерева). Полная таблица ролей — в
// docs/ARCHITECTURE.md, раздел «Роли процессов».
//
// Node-режим проверяется РАНЬШЕ обеих: language-сервер, запущенный нашим
// бинарём, не имеет IPC-канала (subprocess-entry умер бы с exit 2), а флаг роли
// может протечь к нему через spawn среды. Поэтому каждая роль, войдя в свою
// ветку, снимает свой флаг и ставит DIODE_RUN_AS_NODE — см. их entry.

if (process.env.DIODE_RUN_AS_NODE === "1") {
    runAsNode();
} else if (process.env.DIODE_FILE_WATCHER === "1") {
    runTreeWatcherSubprocess();
    // Как и ext-host: возвращается сразу, а процесс живёт на IPC-канале.
} else if (process.env.DIODE_EXTENSION_HOST === "1") {
    runExtensionHostSubprocess();
    // runExtensionHostSubprocess() возвращается, но процесс остаётся живым
    // на IPC-канале до disconnect/shutdown. Просто не идём в TUI-ветку.
} else {
    await runEditor();
}

async function runEditor(): Promise<void> {
    // ── Трасса старта ──────────────────────────────────────────
    // Вехи (`mark`) стоят по всему пути до кадра с файлом; без env
    // DIODE_STARTUP_TRACE они no-op. Бенч читает выгрузку — см. startupTrace.ts.
    const startupTraceFile = setupStartupTrace();
    mark("main:start");

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
        console.log(DIODE_VERSION);
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
        // Не process.exit: код выхода выставлен, а процессу даём завершиться
        // самому — см. комментарий у runExtensionManagement.
        return;
    }

    // Что открываем: папка/файлы/дифф. Пустой набор — законный вход: поднимается
    // пустое окно (см. docs/TODO/Startup.md), cwd при этом НЕ трогается.
    let targets: IStartupTargets;
    try {
        targets = resolveStartupTargets(cli, isExistingDirectory);
    } catch (err) {
        if (err instanceof CliArgsError) {
            console.error(err.message);
            console.error(USAGE);
            process.exit(2);
        }
        throw err;
    }

    // ── Logging ──────────────────────────────────────────────
    // Всегда поднимаем RingBufferSink (источник данных для будущей
    // Output-вкладки). FileSink — только в dev: пишем в ./diode.log в cwd
    // с truncate при каждом запуске. Для агентов/разработчиков это удобный
    // debug-tool; в упакованных сборках файл вообще не создаётся — гейт идёт по
    // isPackagedRuntime(), а не isSeaBinary(): self-extract тоже прод, но не SEA.
    const logService = new LogService();
    // Уровни из `--log`/`--verbose` — до первой записи, в порядке появления в
    // командной строке: последнее правило на тот же канал побеждает.
    for (const rule of cli.logLevels) logService.setLevel(rule.channel, rule.level);
    // Буфер держим в переменной: он же — источник содержимого Output-панели,
    // и подключён до подъёма UI, иначе ранние каналы были бы потеряны.
    const logHistory = new RingBufferSink();
    logService.addSink(logHistory);
    if (!isPackagedRuntime()) {
        logService.addSink(new FileSink(path.resolve(process.cwd(), "diode.log")));
    }
    const bootstrapLogger = logService.createLogger("bootstrap", { label: "Bootstrap" });
    const extensionsLogger = logService.createLogger("extensions", { label: "Extensions" });
    const configurationLogger = logService.createLogger("configuration", { label: "Configuration" });
    bootstrapLogger.info("diode starting", {
        cwd: process.cwd(),
        folder: targets.folder,
        files: targets.files.length,
    });

    // Последняя страховка главного процесса — такая же, как у extension host'а
    // (`extensionHostSubprocess.ts`) и по той же причине. Команды workbench'а
    // сплошь асинхронные, а запускаются они «выстрелил и забыл»; забытый отказ
    // Node по умолчанию считает фатальным и убивает процесс — то есть закрывает
    // редактор со всеми несохранёнными буферами из-за неудачи ОДНОЙ команды.
    // Реальный кейс: Go to Definition в `jdt:`-ресурс (#361). Гасить отказы
    // молча нельзя — они уезжают в лог и видны в Output.
    process.on("unhandledRejection", (reason: unknown) => {
        bootstrapLogger.error(`unhandled rejection: ${describeRejection(reason)}`);
    });

    // ── User data: пути, настройки ─────────────────────────────

    const userDataPaths = resolvePathsFor(cli);
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
    mark("main:config-loaded");
    const userKeybindings = await loadUserKeybindings(userDataPaths.keybindingsFile, configurationLogger);
    mark("main:keybindings-loaded");
    // Машинное состояние UI/сессии (открытые файлы, layout) — отдельно от настроек.
    const stateService = loadState(userDataPaths, configurationLogger);
    mark("main:state-loaded");

    // ── Backend / Theme ────────────────────────────────────────

    // Headless: рендер в память + управление через инспектор, без реального
    // терминала. Иначе — обычный stdin/stdout-бэкенд.
    const headlessBackend = cli.headless
        ? new HeadlessCaptureBackend(new Size(cli.headless.cols, cli.headless.rows))
        : null;
    // Под трассой бэкенд ставит веху на каждый кадр, ушедший в терминал.
    const backend =
        headlessBackend ?? (startupTraceFile !== null ? new TracingNodeTerminalBackend() : new NodeTerminalBackend());
    const application = new TuiApplication(backend);
    // Опциональная самопроверка дерева после каждого кадра (дорогая только
    // относительно, но включается явно): ловит полуприкреплённые элементы.
    application.validateTreeAfterRender = process.env.DIODE_VALIDATE_TREE === "1";
    const clipboard = new OscClipboard((seq) => {
        backend.writeOscSequence(seq);
    });
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
    // `--disable-extensions` гасит ТОЛЬКО пользовательские — встроенные остаются
    // (дословно как в VS Code), иначе вместе с расширениями уехали бы грамматики
    // и конфигурации языков, и флаг стал бы бесполезен для отладки.
    const userExtensions =
        !cli.disableExtensions && fs.existsSync(userDataPaths.extensionsDir)
            ? await scanExtensions(assets, USER_PREFIX, { isBuiltin: false }, extensionsLogger)
            : [];
    if (cli.disableExtensions) extensionsLogger.info("user extensions disabled by --disable-extensions");
    const allExtensions = mergeExtensions(builtinExtensions, userExtensions, extensionsLogger);
    mark("main:extensions-scanned", { builtin: builtinExtensions.length, user: userExtensions.length });

    // ── Темы: встроенные + из расширений, выбор активной ───────
    // Темы расширений (`contributes.themes`) читаются ЗДЕСЬ, до выбора активной
    // и до первого кадра: если `workbench.colorTheme` называет тему расширения,
    // первый кадр уже в ней, без промежуточного Dark Modern (Theming.md, решения
    // 2–3). Файлов немного и они маленькие — это не грамматики.
    const themeRegistry = createBuiltinThemeRegistry();
    const themeContributor = new ExtensionThemeContributor(assets, allExtensions, themeRegistry, extensionsLogger);
    await themeContributor.apply();
    // Неизвестное имя (тема из ещё не установленного или удалённого расширения,
    // опечатка) — откат на дефолт; настройку не трогаем: поставит расширение
    // обратно — получит свою тему без действий (решение 5).
    const colorThemeLabel = configurationService.get<string>("workbench.colorTheme") ?? DEFAULT_COLOR_THEME;
    let initialTheme = themeRegistry.resolve(colorThemeLabel);
    if (initialTheme === undefined) {
        extensionsLogger.warn(`Color theme "${colorThemeLabel}" not found, falling back to "${DEFAULT_COLOR_THEME}"`);
        initialTheme = themeRegistry.resolve(DEFAULT_COLOR_THEME);
    }
    if (initialTheme === undefined) {
        throw new Error(`No built-in theme available (looked up "${colorThemeLabel}" and "${DEFAULT_COLOR_THEME}")`);
    }
    mark("main:themes-ready");

    const languageRegistry = new LanguageRegistry();
    for (const ext of allExtensions) languageRegistry.register(ext);

    // Конфигурации языков (`language-configuration.json`) — ленивые, по тому же
    // адресному пространству ассетов, что и грамматики.
    const languageConfigurationService = new LanguageConfigurationService(assets, languageRegistry, extensionsLogger);

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
        languageConfigurationService,
        configurationService,
        configurationRegistry,
        stateService,
        userKeybindings,
        logService,
        logHistory,
        settingsResource: userDataPaths.settingsFile,
        keybindingsResource: userDataPaths.keybindingsFile,
        // Магазин: тот же выбор источника, что у CLI-установки (`--registry`
        // либо публичный реестр), тот же каталог установки и те же версии для
        // матчинга `engines` — иначе UI показывал бы не то, что поставит CLI.
        extensions: {
            registry: cli.registry,
            extensionsDir: userDataPaths.extensionsDir,
            host: { diode: DIODE_VERSION, vscode: VSCODE_SHIM_VERSION, targetPlatform: currentTargetPlatform() },
            onProblem: (problem) => {
                extensionsLogger.warn(problem);
            },
        },
        extensionHost: {
            // Набор для регистрации в extension host'е: сперва пользовательские,
            // затем встроенные (например `git`).
            extensions: [...userExtensions, ...builtinExtensions],
            registration: {
                userPrefix: USER_PREFIX,
                userExtensionsDir: userDataPaths.extensionsDir,
                // dev — FsAssetAccess, SEA — BundleAssetAccess, единый вызов.
                readBuiltinSource: (virtualPath) => assets.readText(virtualPath),
                configInjection: (ext) =>
                    ext.isBuiltin
                        ? builtinConfigInjection(ext.manifest.name, extensionsLogger)
                        : curatedConfigInjection(ext.id),
            },
            // Приватные каталоги расширений: раскладку знает только владелец
            // user-data, поэтому корни едут отсюда, а не собираются в host'е.
            globalStorageDir: userDataPaths.globalStorageDir,
            workspaceStorageDir: userDataPaths.workspaceStorageDir,
            logsDir: userDataPaths.logsDir,
            secretsFile: userDataPaths.secretsFile,
        },
        hostProcess: {
            exit: () => process.exit(0),
            // Перезагрузка окна: процесс поднимается заново с теми же аргументами
            // (`workbench.action.reloadWindow`, кнопка после установки расширения).
            // Горячей перезагрузки вкладов у нас нет — расширения сканируются один
            // раз на старте, — поэтому «применить» значит «начать сначала».
            restart: () => {
                bootstrapLogger.info("reloading window");
                restartProcess(currentProcessSnapshot(), realRestartHooks);
            },
        },
    });
    mark("main:container-created");

    // Прощание (выход, перезагрузка окна, выход по инспектору) — один путь,
    // `LifecycleService.shutdown`. То, что создано здесь до DI, подписывает
    // владелец — main. Синхронная фаза идёт в порядке, обратном подписке:
    // субпроцессы (подписываются у себя в модулях, позже) и инспектор снимаются
    // раньше терминала, а состояние сессии уходит на диск последним — новое
    // окно читает его на старте, то есть заведомо раньше, чем сработал бы
    // `process.on("exit")`.
    const lifecycle = container.get(LifecycleServiceDIToken);
    lifecycle.onShutdownSync(() => {
        stateService.flushSync();
    });
    lifecycle.onShutdownSync(() => {
        backend.teardown();
    });

    // Страховка сброса состояния на диск — для путей мимо прощания (SIGINT в
    // NodeTerminalBackend): `process.exit` фаерит "exit". Только синхронный
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
    // Сервис расширений (и под ним extension host) — до старта окна: его подписки
    // запоминают события активации (`onLanguage:` открываемых файлов), пришедшие
    // раньше регистрации. Регистрация и стартовая активация — в фазе `restored`.
    const extensionService = container.get(ExtensionServiceDIToken);
    // Корень строим до подписки на фазы ниже: его реестр contributions
    // подписывается в конструкторе, и в `eventually` contribution'ы
    // инстанцируются раньше фонового прогрева грамматик (как и было).
    container.get(WorkbenchComponentDIToken);

    // Остальные грамматики догружаем в фоне, чтобы переключение вкладки на другой
    // язык не ждало парсинга. Фаза `eventually` — уже после первого кадра и спавна
    // extension host'а, так что с критическим путём старта прогрев не конкурирует.
    lifecycle.onDidChangePhase((phase) => {
        if (phase === "eventually") void tokenizationContributor.preloadAll();
    });
    // Конец лестницы: выгружаем трассу целиком (бенч ждёт `complete: true`) —
    // после вехи `main:startup-complete`, которую ставит переход в `eventually`.
    if (startupTraceFile !== null) {
        void lifecycle.when("eventually").then(() => {
            writeStartupTrace(startupTraceFile, true);
        });
    }

    await startWorkbench(
        container,
        { targets, extensions: allExtensions, extensionsLogger },
        {
            attachRoot: (view) => {
                app.root = view;
            },
            run: () => {
                app.run();
            },
            afterMounted: async () => {
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
                                          {
                                              frameCount: () => app.frameCount,
                                              isRenderScheduled: () => app.isRenderScheduled,
                                          },
                                          params,
                                      ),
                                  shutdown: () => {
                                      // Отложенно, чтобы RPC-ответ успел уйти до выхода.
                                      setImmediate(() => {
                                          void lifecycle.shutdown("inspector", () => process.exit(0));
                                      });
                                  },
                              };
                    const inspector = await attachInspector(app, cli.inspectTui, driver);
                    // Порт освобождается до выхода: перезагруженное окно займёт тот же.
                    lifecycle.onShutdownSync(() => {
                        inspector.dispose();
                    });
                    bootstrapLogger.info("TUIDom inspector listening", {
                        host: cli.inspectTui.host,
                        port: inspector.port,
                        headless: headlessBackend !== null,
                    });
                }
            },
            preloadGrammars: (files) => preloadGrammarsForFiles(files, languageRegistry, tokenizationRegistry),
            afterRestored: () => extensionService.start(),
            afterFirstFrame: (callback) => {
                setImmediate(callback);
            },
        },
    );
}

/**
 * Выполняет CLI-команду управления расширениями (--install/--uninstall/--list).
 * Работает по каталогу `<userData>/extensions` без подъёма TUI; вывод — в
 * stdout/stderr, коды выхода 0 (успех) / 1 (ошибка).
 *
 * Код выхода ставится через `process.exitCode`, а не `process.exit()`: установка
 * по id ходит в сеть, и обрыв процесса посреди закрытия http-сокетов роняет libuv
 * на Windows (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`) — после
 * успешной установки пользователь получал бы ассерт в stderr и мусорный код
 * возврата. Держать процесс тут нечему: TUI ещё не поднят, а простаивающие сокеты
 * и таймер `AbortSignal.timeout` цикл событий не держат.
 */
async function runExtensionManagement(cli: ICliArgs): Promise<void> {
    const { extensionsDir } = resolvePathsFor(cli);

    try {
        if (cli.installExtension !== undefined) {
            const target = cli.installExtension;
            // Различаем по суффиксу `.vsix`, как VS Code: он — путь к файлу, всё
            // остальное — id `publisher.name` из реестра. По файловой системе не
            // гадаем: иначе файл с именем вида id, случайно лежащий в рабочем
            // каталоге, молча перехватывал бы установку из реестра.
            let result: { id: string; version: string; previous: string[] };
            if (target.endsWith(".vsix")) {
                result = await installVsix(path.resolve(target), extensionsDir);
            } else {
                // Без --registry идём в публичный реестр Diode: установка по id — это
                // и есть магазин, а локальный каталог/зеркало остаются флагом.
                const source = createRegistrySource(cli.registry, (problem) => {
                    console.error(problem);
                });
                result = await installFromRegistry(source, target, {
                    extensionsDir,
                    host: {
                        diode: DIODE_VERSION,
                        vscode: VSCODE_SHIM_VERSION,
                        targetPlatform: currentTargetPlatform(),
                    },
                });
            }
            const { id, version, previous } = result;
            console.log(`Installed ${id}@${version}`);
            const removed = previous.filter((v) => v !== version);
            if (removed.length > 0) {
                console.log(`Removed previous version(s): ${removed.join(", ")}`);
            }
            return;
        }

        if (cli.uninstallExtension !== undefined) {
            const id = cli.uninstallExtension;
            const { removed } = uninstallExtension(id, extensionsDir);
            if (removed.length === 0) {
                console.error(`Extension ${id} is not installed`);
                process.exitCode = 1;
                return;
            }
            console.log(`Uninstalled ${id} (${removed.length} version(s))`);
            return;
        }

        // --list-extensions
        for (const ext of listInstalledExtensions(extensionsDir)) {
            console.log(`${ext.id}@${ext.version}`);
        }
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
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
/**
 * Единый резолв путей user data по аргументам: и CLI-ветка управления
 * расширениями, и редактор обязаны смотреть в один каталог расширений, иначе
 * `--install-extension --extensions-dir X` ставил бы туда, куда редактор не
 * смотрит.
 */
function resolvePathsFor(cli: ICliArgs): IUserDataPaths {
    return resolveUserDataPaths({
        userDataDir: cli.userDataDir,
        profile: cli.profile,
        homedir: os.homedir(),
        ...(cli.extensionsDir !== undefined ? { extensionsDir: cli.extensionsDir } : {}),
    });
}

/** Порт к FS для {@link resolveStartupTargets}: путь существует и это папка. */
function isExistingDirectory(absolutePath: string): boolean {
    return fs.statSync(absolutePath, { throwIfNoEntry: false })?.isDirectory() === true;
}

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
 * Синтетические config-дефолты host'а для builtin-расширений (в манифесте их
 * нет — это внутренний seam, не пользовательские настройки).
 *
 * Для `diode-lsp-typescript` — вшитый language-сервер: целевые пути распаковки
 * (детерминированы от версии+хэша бандла — их можно раздать ДО распаковки;
 * готовность клиент проверяет existsSync самого entry, публикация атомарна)
 * и режим node-рантайма. Сама распаковка стартует здесь же fire-and-forget —
 * после первого кадра, вне перцептивно-критического пути (VISION).
 */
function builtinConfigInjection(manifestName: string, logger: ILogger): Record<string, unknown> {
    if (manifestName !== "diode-lsp-typescript") return {};
    const target = bundledTsServerTarget();
    if (target === null) return {};
    void ensureTsServer((err) => {
        logger.error("bundled ts-server unpack failed", err);
    });
    return {
        "diode.lsp.typescript.bundledServerPath": target.serverPath,
        "diode.lsp.typescript.bundledTsserverPath": target.tsserverPath,
        // SEA: сервер запускается нашим же бинарём в node-режиме (runAsNode.ts);
        // dev/self-extract: process.execPath субпроцесса — настоящий node.
        "diode.lsp.typescript.serverRuntime": isSeaBinary() ? "diode-as-node" : "node",
    };
}
