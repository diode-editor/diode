import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { startupSnapshot } from "node:v8";

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
import { setUnexpectedErrorHandler } from "../base/common/errors.ts";
import { setLazyModuleLoader } from "../base/common/lazyModule.ts";
import { mark } from "../base/common/performance.ts";
import { DIODE_VERSION } from "../base/common/version.ts";
import { createDefaultAssetAccess } from "../base/node/assets/createDefaultAssetAccess.ts";
import { FsAssetAccess } from "../base/node/assets/fsAssetAccess.ts";
import { isPackagedRuntime } from "../base/node/assets/packagedRuntime.ts";
import { isSeaBinary } from "../base/node/isSea.ts";
import { loadLazyModule } from "../base/node/lazyModule.ts";
import { currentProcessSnapshot, realRestartHooks, restartProcess } from "../base/node/restartProcess.ts";
import { ColorMapTokenStyleResolver } from "../editor/common/languages/colorMapTokenStyleResolver.ts";
import type { ILanguageService } from "../editor/common/languages/iLanguageService.ts";
import { TokenizationRegistry } from "../editor/common/languages/tokenizationRegistry.ts";
import { OscClipboard } from "../platform/clipboard/common/oscClipboard.ts";
import { CommandRegistryDIToken } from "../platform/commands/common/commandRegistry.ts";
import { ConfigurationRegistry } from "../platform/configuration/common/configurationRegistry.ts";
import { loadConfiguration } from "../platform/configuration/node/configurationService.ts";
import { ContextKeyServiceDIToken } from "../platform/contextkey/common/contextKeyService.ts";
import type { ICliArgs } from "../platform/environment/node/cliArgs.ts";
import {
    CliArgsError,
    parseCliArgs,
    relaunchArgs,
    relaunchWorkspace,
    USAGE,
} from "../platform/environment/node/cliArgs.ts";
import { createEnvironmentService } from "../platform/environment/node/environmentService.ts";
import type { IStartupTargets, IStartupWorkspace } from "../platform/environment/node/startupTargets.ts";
import { logicalWorkingDirectory, resolveStartupTargets } from "../platform/environment/node/startupTargets.ts";
import type { IUserDataPaths } from "../platform/environment/node/userDataPaths.ts";
import { resolveUserDataPaths } from "../platform/environment/node/userDataPaths.ts";
import type { IExtensionRegistrySource } from "../platform/extensionManagement/common/iExtensionRegistrySource.ts";
import { createRegistrySource } from "../platform/extensionManagement/node/createRegistrySource.ts";
import { installVsix, readVsixManifest } from "../platform/extensionManagement/node/extensionInstaller.ts";
import {
    describeDependencyInstall,
    type IDependencyInstallResult,
    type IInstalledFromRegistry,
    installDependenciesFromRegistry,
    installFromRegistry,
} from "../platform/extensionManagement/node/installFromRegistry.ts";
import {
    createProfileExtensions,
    deleteUnusedExtensions,
    migrateProfileExtensions,
    PROFILE_EXTENSIONS_FILE,
    profileExtensionsFiles,
} from "../platform/extensionManagement/node/profileExtensions.ts";
import { currentTargetPlatform } from "../platform/extensionManagement/node/targetPlatform.ts";
import { extensionKey, readExtensionDependencies } from "../platform/extensions/common/extensionDependencies.ts";
import { scanExtensions } from "../platform/extensions/common/extensionScanner.ts";
import { mergeExtensions } from "../platform/extensions/common/mergeExtensions.ts";
import { ChokidarFileWatcher } from "../platform/files/node/chokidarFileWatcher.ts";
import { loadUserKeybindings } from "../platform/keybinding/node/keybindingsService.ts";
import { TuiApplicationDIToken } from "../platform/layout/browser/tuiApplicationDIToken.ts";
import type { ILogger } from "../platform/log/common/iLogger.ts";
import { LogService } from "../platform/log/common/logService.ts";
import { RingBufferSink } from "../platform/log/common/ringBufferSink.ts";
import { FileSink } from "../platform/log/node/fileSink.ts";
import { loadApplicationState, loadState } from "../platform/state/node/stateService.ts";
import { createDefaultTokenClassificationRegistry } from "../platform/theme/common/tokenClassificationRegistry.ts";
import {
    type IUserDataProfile,
    profileWorkspaceKey,
    profileWorkspaceKeyOf,
    resolveActiveProfile,
} from "../platform/userDataProfile/common/userDataProfile.ts";
import { UserDataProfilesService } from "../platform/userDataProfile/node/userDataProfilesService.ts";
import { IWorkspaceContextServiceDIToken } from "../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import {
    type IWorkspaceFileReader,
    loadWorkspaceFile,
    WorkspaceFileError,
} from "../platform/workspace/common/workspaceFile.ts";
import { VSCODE_SHIM_VERSION } from "../workbench/api/common/vscodeShimVersion.ts";
import { WorkbenchComponentDIToken } from "../workbench/browser/workbenchComponent.ts";
import { CONFIGURATION_CONTRIBUTIONS } from "../workbench/common/configuration/configurationContributions.ts";
import { ExtensionConfigurationContributor } from "../workbench/services/extensions/common/extensionConfigurationContributor.ts";
import { ExtensionServiceDIToken } from "../workbench/services/extensions/common/extensions.ts";
import { registerExtensionSemanticTokens } from "../workbench/services/extensions/common/extensionSemanticTokensContributor.ts";
import { ExtensionThemeContributor } from "../workbench/services/extensions/common/extensionThemeContributor.ts";
import { ExtensionTokenizationContributor } from "../workbench/services/extensions/common/extensionTokenizationContributor.ts";
import { bundledTsServerTarget, ensureTsServer } from "../workbench/services/extensions/node/loadTsServer.ts";
import { LanguageConfigurationService } from "../workbench/services/language/common/languageConfigurationService.ts";
import { LanguageRegistry } from "../workbench/services/language/common/languageRegistry.ts";
import { LifecycleServiceDIToken } from "../workbench/services/lifecycle/browser/lifecycleService.ts";
import { OutputServiceDIToken } from "../workbench/services/output/common/outputService.ts";
import { SemanticTokenStyleResolver } from "../workbench/services/themes/common/semanticTokenStyleResolver.ts";
import { createTextMateTheme } from "../workbench/services/themes/common/textMateTheme.ts";
import { createBuiltinThemeRegistry } from "../workbench/services/themes/common/themeRegistry.ts";
import { DEFAULT_COLOR_THEME } from "../workbench/services/themes/common/themes/builtinThemes.ts";
import { ThemeServiceDIToken } from "../workbench/services/themes/common/themeTokens.ts";

import { curatedConfigInjection } from "./curatedConfigInjection.ts";
import { registerDiodeInspectorMethods } from "./diodeInspectorMethods.ts";
import { createProductionContainer } from "./modules/productionProfile.ts";
import { runAsNode } from "./runAsNode.ts";
import { setupStartupTrace, TracingNodeTerminalBackend, writeStartupTrace } from "./startupTrace.ts";
import { startWorkbench } from "./workbenchStartup.ts";

// До любой роли: без node-загрузчика упакованная сборка искала бы ленивый кусок в node_modules, которых у неё нет.
setLazyModuleLoader(loadLazyModule);

// Отказ входа — исключением вне промиса (стек в stderr, код 1): страховка `unhandledRejection`
// редактора унесла бы его в лог, и процесс жил бы без UI.
function start(): void {
    main().catch((err: unknown) => {
        process.nextTick(() => {
            throw err;
        });
    });
}

// V8-снапшот (`useSnapshot`, scripts/build-sea.mjs): при сборке исполняется только верхний уровень
// модулей, всё зависящее от процесса читает `start` после десериализации (docs/arch/Common.md).
if (startupSnapshot.isBuildingSnapshot()) {
    startupSnapshot.setDeserializeMainFunction(start);
} else {
    start();
}

async function main(): Promise<void> {
    // Node-режим — раньше ролей: language-сервер, запущенный нашим бинарём, без IPC-канала, а флаг роли
    // может протечь к нему через env. Поэтому роль, войдя в ветку, снимает свой флаг и ставит DIODE_RUN_AS_NODE.
    if (process.env.DIODE_RUN_AS_NODE === "1") {
        runAsNode();
    } else if (process.env.DIODE_FILE_WATCHER === "1") {
        const { runFileWatcherRole } = await loadLazyModule(
            "roles/file-watcher",
            () => import("./roles/fileWatcherRole.ts"),
        );
        runFileWatcherRole();
    } else if (process.env.DIODE_EXTENSION_HOST === "1") {
        const { runExtensionHostRole } = await loadLazyModule(
            "roles/extension-host",
            () => import("./roles/extensionHostRole.ts"),
        );
        runExtensionHostRole();
        // Роль возвращается сразу, а процесс живёт на IPC-канале.
    } else {
        await runEditor();
    }
}

async function runEditor(): Promise<void> {
    const startupTraceFile = setupStartupTrace();
    mark("main:start");

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

    if (cli.installExtension !== undefined || cli.uninstallExtension !== undefined || cli.listExtensions) {
        await runExtensionManagement(cli);
        // Не process.exit — см. runExtensionManagement.
        return;
    }

    // Пустой набор — законный вход (пустое окно); cwd вместо папки не подставляется.
    let targets: IStartupTargets;
    try {
        const cwd = logicalWorkingDirectory(process.env.PWD, process.cwd(), isSameDirectory);
        targets = resolveStartupTargets(cli, isExistingDirectory, cwd);
    } catch (err) {
        if (err instanceof CliArgsError) {
            console.error(err.message);
            console.error(USAGE);
            process.exit(2);
        }
        throw err;
    }

    let workspace: IStartupWorkspace | undefined;
    if (targets.workspaceFile !== undefined) {
        try {
            const contents = await loadWorkspaceFile(targets.workspaceFile, nodeWorkspaceFileReader());
            workspace = { file: targets.workspaceFile, contents };
            targets = { ...targets, folder: contents.folder };
        } catch (err) {
            if (err instanceof WorkspaceFileError) {
                console.error(err.message);
                process.exit(1);
            }
            throw err;
        }
    }

    // FileSink — только вне упаковки: гейт по isPackagedRuntime(), а не isSeaBinary(), — self-extract тоже прод, но не SEA.
    const logService = new LogService();
    // До первой записи; последнее правило на тот же канал побеждает.
    for (const rule of cli.logLevels) logService.setLevel(rule.channel, rule.level);
    // Подключён до подъёма UI, иначе ранние каналы пропали бы из Output.
    const logHistory = new RingBufferSink();
    logService.addSink(logHistory);
    if (!isPackagedRuntime()) {
        logService.addSink(new FileSink(path.resolve(process.cwd(), "diode.log")));
    }
    const bootstrapLogger = logService.createLogger("bootstrap", { label: "Bootstrap" });
    const extensionsLogger = logService.createLogger("extensions", { label: "Extensions" });
    const configurationLogger = logService.createLogger("configuration", { label: "Configuration" });
    const profilesLogger = logService.createLogger("profiles", { label: "Profiles" });

    // Забытый отказ «выстрелил и забыл»-команды Node считает фатальным и закрыл бы редактор с несохранёнными
    // буферами (#361: Go to Definition в `jdt:`). Молча не гасим — в лог.
    process.on("unhandledRejection", (reason: unknown) => {
        bootstrapLogger.error(`unhandled rejection: ${describeRejection(reason)}`);
    });
    // По умолчанию они пишутся в console.error — поверх экрана TUI.
    setUnexpectedErrorHandler((e: unknown) => {
        bootstrapLogger.error(`unexpected error: ${describeRejection(e)}`);
    });

    // Реестр профилей — раньше всего: от него зависит каталог профиля. Резолв как у эталона:
    // `--profile` → привязка воркспейса → Default.
    const { basePaths, applicationState, profilesService } = openProfiles(cli, profilesLogger);
    // Эталон делает эту уборку на следующем старте (`deleteExtensionsNotInProfiles`).
    profilesService.onDidChangeProfiles((e) => {
        if (e.removed.length === 0) return;
        try {
            const deleted = deleteUnusedExtensions(basePaths.extensionsDir, allProfileExtensionsFiles(profilesService));
            if (deleted.length > 0) extensionsLogger.info("Deleted extensions no profile uses", { deleted });
        } catch (err) {
            extensionsLogger.error("Failed to delete extensions no profile uses", err);
        }
    });
    const workspaceKey = (() => {
        const target = targets.workspaceFile ?? targets.folder;
        return target === undefined ? undefined : profileWorkspaceKeyOf(target);
    })();
    const activeProfile = await resolveActiveProfile(profilesService, {
        forceProfile: cli.profile,
        workspace: workspaceKey,
    });
    bootstrapLogger.info("diode starting", {
        cwd: process.cwd(),
        folder: targets.folder,
        workspaceFile: workspace?.file,
        files: targets.files.length,
        profile: activeProfile.name,
    });

    const userDataPaths = resolvePathsFor(cli, activeProfile.isDefault ? undefined : activeProfile.id);
    // Живёт всё время работы приложения; fd освобождает ОС на выходе.
    const settingsWatcher = new ChokidarFileWatcher();
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
    // `--disable-extensions` гасит только пользовательские, как VS Code: со встроенными уехали бы грамматики
    // и конфигурации языков. Профиль фиксирован на процесс: смена — перезагрузка окна и новый скан.
    const profileExtensionKeys = new Set(
        createProfileExtensions({
            extensionsDir: userDataPaths.extensionsDir,
            profile: activeProfile,
            profiles: profilesService,
            logger: extensionsLogger,
        })
            .list()
            .map((e) => extensionKey(e.id)),
    );
    const userExtensions =
        !cli.disableExtensions && fs.existsSync(userDataPaths.extensionsDir)
            ? (await scanExtensions(assets, USER_PREFIX, { isBuiltin: false }, extensionsLogger)).filter((e) =>
                  profileExtensionKeys.has(extensionKey(e.id)),
              )
            : [];
    if (cli.disableExtensions) extensionsLogger.info("user extensions disabled by --disable-extensions");
    const allExtensions = mergeExtensions(builtinExtensions, userExtensions, extensionsLogger);
    mark("main:extensions-scanned", { builtin: builtinExtensions.length, user: userExtensions.length });

    // Скан расширений — до загрузки настроек: defaults-слой собирается из полного реестра.
    const configurationRegistry = new ConfigurationRegistry(CONFIGURATION_CONTRIBUTIONS);
    new ExtensionConfigurationContributor(
        allExtensions,
        configurationRegistry,
        (ext) => (ext.isBuiltin ? builtinConfigInjection(ext.manifest.name) : curatedConfigInjection(ext.id)),
        extensionsLogger,
    ).apply();
    // Папка — уже здесь: `.diode/settings.json` проекта обязан действовать с первого кадра.
    const configurationService = await loadConfiguration(
        userDataPaths,
        configurationLogger,
        settingsWatcher,
        configurationRegistry,
        targets.folder === undefined ? undefined : { folder: targets.folder, configuration: workspace?.file },
    );
    mark("main:config-loaded");
    const userKeybindings = await loadUserKeybindings(userDataPaths.keybindingsFile, configurationLogger);
    mark("main:keybindings-loaded");
    // Application-стор усыновляется сервисом: писатель у `storage.json` один.
    const stateService = loadState(userDataPaths, configurationLogger, applicationState);
    mark("main:state-loaded");

    const headlessBackend = cli.headless
        ? new HeadlessCaptureBackend(new Size(cli.headless.cols, cli.headless.rows))
        : null;
    const backend =
        headlessBackend ?? (startupTraceFile !== null ? new TracingNodeTerminalBackend() : new NodeTerminalBackend());
    const application = new TuiApplication(backend);
    application.validateTreeAfterRender = process.env.DIODE_VALIDATE_TREE === "1";
    const clipboard = new OscClipboard((seq) => {
        backend.writeOscSequence(seq);
    });
    // Темы расширений — до выбора активной: первый кадр сразу в теме из `workbench.colorTheme`, без Dark Modern.
    const themeRegistry = createBuiltinThemeRegistry();
    const themeContributor = new ExtensionThemeContributor(assets, allExtensions, themeRegistry, extensionsLogger);
    await themeContributor.apply();
    // Настройку не трогаем: вернётся расширение — вернётся и его тема.
    const colorThemeLabel = configurationService.get("workbench.colorTheme");
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

    const languageConfigurationService = new LanguageConfigurationService(assets, languageRegistry, extensionsLogger);

    const tokenizationRegistry = new TokenizationRegistry();
    const tokenizationContributor = new ExtensionTokenizationContributor(
        assets,
        allExtensions,
        tokenizationRegistry,
        extensionsLogger,
    );
    tokenizationContributor.apply();
    // До первой токенизации: цвета токенов — индексы colorMap темы.
    tokenizationContributor.setTheme(createTextMateTheme(initialTheme));

    const tokenStyleResolver = new ColorMapTokenStyleResolver(tokenizationRegistry);
    const tokenClassificationRegistry = createDefaultTokenClassificationRegistry();
    registerExtensionSemanticTokens(allExtensions, tokenClassificationRegistry, extensionsLogger);
    const semanticTokenStyleResolver = new SemanticTokenStyleResolver(
        tokenClassificationRegistry,
        initialTheme.tokenTheme,
    );

    const container = createProductionContainer({
        app: application,
        backend,
        theme: initialTheme,
        themeRegistry,
        clipboard,
        tokenizationRegistry,
        tokenStyleResolver,
        semanticTokenStyleResolver,
        languageService: languageRegistry,
        languageConfigurationService,
        configurationService,
        configurationRegistry,
        stateService,
        userKeybindings,
        logService,
        logHistory,
        // Магазин берёт отсюда тот же источник и каталог, что CLI-установка, — иначе UI показывал бы не то, что поставит CLI.
        environment: createEnvironmentService(userDataPaths, cli),
        extensions: {
            host: { diode: DIODE_VERSION, vscode: VSCODE_SHIM_VERSION, targetPlatform: currentTargetPlatform() },
            onProblem: (problem) => {
                extensionsLogger.warn(problem);
            },
        },
        extensionHost: {
            // Сперва пользовательские, затем встроенные.
            extensions: [...userExtensions, ...builtinExtensions],
            registration: {
                userPrefix: USER_PREFIX,
                userExtensionsDir: userDataPaths.extensionsDir,
                readBuiltinSource: (virtualPath) => assets.readText(virtualPath),
            },
        },
        hostProcess: {
            exit: () => process.exit(0),
            // Профиль следующего окна — всегда явный `--profile`: прежний флаг из argv перебил бы только что
            // записанную привязку. Горячей перезагрузки вкладов нет — «применить» значит «начать сначала».
            restart: (relaunch) => {
                const current = profileWorkspaceKey(container.get(IWorkspaceContextServiceDIToken).getWorkspace());
                const next = relaunchArgs(process.argv.slice(2), {
                    profile: relaunch?.profile ?? activeProfile.name,
                    workspace: relaunchWorkspace(relaunch?.workspace, workspaceKey, current),
                });
                bootstrapLogger.info("reloading window", { args: next });
                restartProcess(currentProcessSnapshot(), realRestartHooks, next);
            },
        },
        userDataProfile: {
            profilesService,
            currentProfile: activeProfile,
            // OSC 0 напрямую, без tmux passthrough: tmux сам ставит заголовок панели.
            terminalTitle: (title) => {
                backend.setWindowTitle(title);
            },
        },
    });
    mark("main:container-created");

    // Синхронная фаза прощания — в порядке, обратном подписке: субпроцессы и инспектор снимаются раньше
    // терминала, состояние сессии уходит на диск последним.
    const lifecycle = container.get(LifecycleServiceDIToken);

    // Бутстрапная папка уже прочитана выше — повторная установка той же папки no-op.
    const workspaceContext = container.get(IWorkspaceContextServiceDIToken);
    workspaceContext.onDidChangeWorkspaceFolders(() => {
        const current = workspaceContext.getWorkspace();
        void configurationService.setWorkspace(
            current.folders.map((folder) => folder.uri.fsPath),
            current.configuration?.fsPath,
        );
    });
    lifecycle.onShutdownSync(() => {
        stateService.flushSync();
    });
    lifecycle.onShutdownSync(() => {
        backend.teardown();
    });

    // Страховка для путей мимо прощания (SIGINT в NodeTerminalBackend): на "exit" — только синхронный I/O.
    process.on("exit", () => {
        try {
            stateService.flushSync();
        } catch {
            /* на выходе делать нечего — глотаем */
        }
    });

    // Токены несут индексы colorMap прежней темы — документы перетокенизируются, как у эталона.
    container.get(ThemeServiceDIToken).onThemeChange((theme) => {
        tokenizationContributor.setTheme(createTextMateTheme(theme));
        semanticTokenStyleResolver.setTheme(theme.tokenTheme);
    });

    const app = container.get(TuiApplicationDIToken);
    // До старта окна: его подписки запоминают события активации, пришедшие раньше регистрации.
    const extensionService = container.get(ExtensionServiceDIToken);
    // Корень — до подписки на фазы ниже: в `eventually` contribution'ы инстанцируются раньше прогрева грамматик.
    container.get(WorkbenchComponentDIToken);

    lifecycle.onDidChangePhase((phase) => {
        if (phase === "eventually") void tokenizationContributor.preloadAll();
    });

    // `Diode.whenReady` инспектора — тот же момент, что `complete: true` в трассе старта.
    const startupComplete = Promise.withResolvers<undefined>();

    await startWorkbench(
        container,
        { targets, workspace, extensions: allExtensions, extensionsLogger },
        {
            attachRoot: (view) => {
                app.root = view;
            },
            run: () => {
                app.run();
            },
            afterMounted: async () => {
                // Порт — только в logService: stderr уходит в тот же pty и портит рендер.
                if (cli.inspectTui !== undefined) {
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
                                      // Протокол — 0-based ячейки, терминальные последовательности — 1-based.
                                      headlessBackend.sendMouse({ ...params, x: params.x + 1, y: params.y + 1 });
                                  },
                                  resize: (cols, rows) => {
                                      headlessBackend.resize(new Size(cols, rows));
                                  },
                                  captureFrame: async () => {
                                      // Слить кадр, отложенный на setImmediate (scheduleRender).
                                      await new Promise<void>((resolve) => setImmediate(resolve));
                                      return headlessBackend.captureFrame();
                                  },
                                  waitForIdle: (params) =>
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
                    registerDiodeInspectorMethods(
                        (method, handler) => {
                            inspector.core.register(method, handler);
                        },
                        {
                            commands: container.get(CommandRegistryDIToken),
                            output: container.get(OutputServiceDIToken),
                            contextKeys: container.get(ContextKeyServiceDIToken),
                            ready: startupComplete.promise,
                            pid: process.pid,
                        },
                    );
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
            startExtensions: () => {
                // До спауна extension host'а, но не на пути к первому кадру: на холодном кэше распаковка синхронна (~20 мс).
                void ensureTsServer((err) => {
                    extensionsLogger.error("bundled ts-server unpack failed", err);
                });
                const activation = extensionService.start();
                // `main:startup-complete` и `exthost:activated` друг друга не ждут; трасса целиком (бенч ждёт
                // `complete: true`) — когда есть обе.
                void Promise.all([activation, lifecycle.when("eventually")]).then(() => {
                    if (startupTraceFile !== null) writeStartupTrace(startupTraceFile, true);
                    startupComplete.resolve(undefined);
                });
            },
            afterNextFrame: (callback) => {
                setImmediate(callback);
            },
        },
    );
}

/**
 * Код выхода — через `process.exitCode`, а не `process.exit()`: обрыв посреди закрытия http-сокетов
 * роняет libuv на Windows (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`).
 */
async function runExtensionManagement(cli: ICliArgs): Promise<void> {
    const { extensionsDir } = resolvePathsFor(cli);

    try {
        // Без `--profile` — Default, как `cliProcessMain` эталона; привязок воркспейсов CLI не трогает.
        const { profilesService } = openProfiles(cli);
        let profile: IUserDataProfile = profilesService.defaultProfile;
        if (cli.profile !== undefined) {
            const named = profilesService.profiles.find((p) => p.name === cli.profile);
            if (named === undefined) throw new Error(`Profile '${cli.profile}' not found.`);
            profile = named;
        }
        const profileExtensions = createProfileExtensions({ extensionsDir, profile, profiles: profilesService });

        if (cli.installExtension !== undefined) {
            const target = cli.installExtension;
            // По суффиксу `.vsix`, как VS Code, а не по ФС: файл с именем вида id в cwd молча перехватывал бы
            // установку из реестра. Реестр нужен и `.vsix`: его зависимости едут оттуда.
            const registry = (): IExtensionRegistrySource =>
                createRegistrySource(cli.registry, (problem) => {
                    console.error(problem);
                });
            const options = {
                extensionsDir,
                host: { diode: DIODE_VERSION, vscode: VSCODE_SHIM_VERSION, targetPlatform: currentTargetPlatform() },
            };
            let result: IInstalledFromRegistry;
            let dependencies: IDependencyInstallResult = { dependencies: [], missingDependencies: [] };
            if (target.endsWith(".vsix")) {
                const vsixPath = path.resolve(target);
                result = await installVsix(vsixPath, extensionsDir);
                const manifest = await readVsixManifest(vsixPath);
                if (readExtensionDependencies(manifest).length > 0) {
                    try {
                        dependencies = await installDependenciesFromRegistry(registry(), result.id, manifest, options);
                    } catch (err) {
                        // Как у VS Code для VSIX: сбой зависимостей — предупреждение, а не отказ установки.
                        console.error(`Warning: ${err instanceof Error ? err.message : String(err)}`);
                    }
                }
            } else {
                const installed = await installFromRegistry(registry(), target, options);
                result = installed;
                dependencies = installed;
            }
            // В профиль — вместе с зависимостями, и с теми, что уже лежали на диске для другого профиля.
            profileExtensions.add([result.id]);
            const { id, version, previous } = result;
            console.log(`Installed ${id}@${version}`);
            const removed = previous.filter((v) => v !== version);
            if (removed.length > 0) {
                console.log(`Removed previous version(s): ${removed.join(", ")}`);
            }
            const report = describeDependencyInstall(id, dependencies);
            for (const line of report.info) console.log(line);
            for (const line of report.warnings) console.error(line);
            return;
        }

        if (cli.uninstallExtension !== undefined) {
            const id = cli.uninstallExtension;
            const { removed } = profileExtensions.remove(id);
            if (!removed) {
                console.error(`Extension ${id} is not installed`);
                process.exitCode = 1;
                return;
            }
            console.log(`Uninstalled ${id}`);
            return;
        }

        for (const ext of profileExtensions.list()) {
            console.log(`${ext.id}@${ext.version}`);
        }
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
    }
}

/**
 * CLI и редактор обязаны смотреть в один каталог расширений. `profileId` — каталог профиля из реестра,
 * а не имя из `--profile`.
 */
function resolvePathsFor(cli: ICliArgs, profileId?: string): IUserDataPaths {
    return resolveUserDataPaths({
        userDataDir: cli.userDataDir,
        profile: profileId,
        homedir: os.homedir(),
        ...(cli.extensionsDir !== undefined ? { extensionsDir: cli.extensionsDir } : {}),
    });
}

/** Сбой миграции состава — в лог: старт он не роняет. */
function openProfiles(cli: ICliArgs, logger?: ILogger) {
    const basePaths = resolvePathsFor(cli);
    const applicationState = loadApplicationState(basePaths.applicationStateFile, logger);
    const profilesService = new UserDataProfilesService({
        profilesHome: basePaths.profilesHome,
        defaultProfileHome: basePaths.userDir,
        defaultProfileExtensionsResource: path.join(basePaths.extensionsDir, PROFILE_EXTENSIONS_FILE),
        state: applicationState,
        ...(logger !== undefined ? { logger } : {}),
    });
    profilesService.migrateProfileDirectories();
    try {
        const migrated = migrateProfileExtensions(basePaths.extensionsDir, allProfileExtensionsFiles(profilesService));
        if (migrated.length > 0) logger?.info("Profiles got all installed extensions", { files: migrated });
    } catch (err) {
        logger?.error("Failed to migrate profile extensions", err);
    }
    return { basePaths, applicationState, profilesService };
}

function allProfileExtensionsFiles(profiles: UserDataProfilesService): string[] {
    return profileExtensionsFiles(
        profiles.profiles.map((p) => p.extensionsResource),
        profiles.profilesHome,
    );
}

function isExistingDirectory(absolutePath: string): boolean {
    return fs.statSync(absolutePath, { throwIfNoEntry: false })?.isDirectory() === true;
}

function isSameDirectory(a: string, b: string): boolean {
    const statA = fs.statSync(a, { throwIfNoEntry: false });
    const statB = fs.statSync(b, { throwIfNoEntry: false });
    if (statA === undefined || statB === undefined) return false;
    return statA.dev === statB.dev && statA.ino === statB.ino;
}

/** Функция, а не константа: `main()` исполняется раньше объявлений внизу модуля — `const` был бы в TDZ. */
function nodeWorkspaceFileReader(): IWorkspaceFileReader {
    return {
        readText: (filePath) => fs.promises.readFile(filePath, "utf-8"),
        isDirectory: (filePath) => Promise.resolve(isExistingDirectory(filePath)),
    };
}

/** `load()` не реджектится: сбойная грамматика оставит язык на fallback'е, старт не упадёт. */
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
 * Пути распаковки вшитого tsserver детерминированы версией и хэшем бандла — их раздают до распаковки
 * (она — в `startExtensions`, за первыми кадрами).
 */
function builtinConfigInjection(manifestName: string): Record<string, unknown> {
    if (manifestName !== "diode-lsp-typescript") return {};
    const target = bundledTsServerTarget();
    if (target === null) return {};
    return {
        "diode.lsp.typescript.bundledServerPath": target.serverPath,
        "diode.lsp.typescript.bundledTsserverPath": target.tsserverPath,
        // SEA: сервер запускается нашим же бинарём в node-режиме (runAsNode.ts);
        // dev/self-extract: process.execPath субпроцесса — настоящий node.
        "diode.lsp.typescript.serverRuntime": isSeaBinary() ? "diode-as-node" : "node",
    };
}
