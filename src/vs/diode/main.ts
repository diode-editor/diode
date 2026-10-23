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
import { AdjustableClockDIToken } from "../platform/clock/common/clock.ts";
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
import { getIdAndVersion } from "../platform/extensionManagement/common/getIdAndVersion.ts";
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
    cleanUpExtensions,
    releaseExtensionLease,
    writeExtensionLease,
} from "../platform/extensionManagement/node/obsoleteExtensions.ts";
import {
    createProfileExtensions,
    markUnusedExtensions,
    migrateProfileExtensions,
    PROFILE_EXTENSIONS_FILE,
    profileExtensionsFiles,
    referencedExtensionDirs,
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
import {
    getColorThemeSettingId,
    LAST_HOST_COLOR_SCHEME,
} from "../workbench/services/themes/common/themeConfiguration.ts";
import { createBuiltinThemeRegistry } from "../workbench/services/themes/common/themeRegistry.ts";
import { DEFAULT_COLOR_THEME } from "../workbench/services/themes/common/themes/builtinThemes.ts";
import { ThemeServiceDIToken } from "../workbench/services/themes/common/themeTokens.ts";

import { curatedConfigInjection } from "./curatedConfigInjection.ts";
import { registerDiodeInspectorMethods } from "./diodeInspectorMethods.ts";
import { createProductionContainer } from "./modules/productionProfile.ts";
import { runAsNode } from "./runAsNode.ts";
import { setupStartupTrace, TracingNodeTerminalBackend, writeStartupTrace } from "./startupTrace.ts";
import { startWorkbench } from "./workbenchStartup.ts";

// Before any role: without the node loader the packaged build would look up lazy chunks in node_modules, which it lacks.
setLazyModuleLoader(loadLazyModule);

// Entry failure is thrown outside the promise (stack to stderr, exit code 1): the editor's `unhandledRejection`
// safety net would send it to the log, and the process would live on without UI.
function start(): void {
    main().catch((err: unknown) => {
        process.nextTick(() => {
            throw err;
        });
    });
}

// V8 snapshot (`useSnapshot`, scripts/build-sea.mjs): the build runs only the module top level;
// everything process-dependent reads `start` after deserialization (docs/arch/Common.md).
if (startupSnapshot.isBuildingSnapshot()) {
    startupSnapshot.setDeserializeMainFunction(start);
} else {
    start();
}

async function main(): Promise<void> {
    // Node mode before roles: a language server started by our binary has no IPC channel, and a role flag
    // may leak to it through env. So a role, on entering its branch, clears its flag and sets DIODE_RUN_AS_NODE.
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
        // The role returns immediately, and the process lives on the IPC channel.
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
        // Not process.exit — see runExtensionManagement.
        return;
    }

    // An empty set is a valid input (empty window); cwd is not substituted for the folder.
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

    // FileSink only outside packaging: gated on isPackagedRuntime(), not isSeaBinary() — self-extract is prod too, but not SEA.
    const logService = new LogService();
    // Before the first write; the last rule for the same channel wins.
    for (const rule of cli.logLevels) logService.setLevel(rule.channel, rule.level);
    // Attached before the UI comes up, otherwise early channels would be missing from Output.
    const logHistory = new RingBufferSink();
    logService.addSink(logHistory);
    if (!isPackagedRuntime()) {
        logService.addSink(new FileSink(path.resolve(process.cwd(), "diode.log")));
    }
    const bootstrapLogger = logService.createLogger("bootstrap", { label: "Bootstrap" });
    const extensionsLogger = logService.createLogger("extensions", { label: "Extensions" });
    const configurationLogger = logService.createLogger("configuration", { label: "Configuration" });
    const profilesLogger = logService.createLogger("profiles", { label: "Profiles" });

    // Node treats a forgotten rejection of a fire-and-forget command as fatal and would close the editor with unsaved
    // buffers (#361: Go to Definition in `jdt:`). Don't swallow it silently — log it.
    process.on("unhandledRejection", (reason: unknown) => {
        bootstrapLogger.error(`unhandled rejection: ${describeRejection(reason)}`);
    });
    // By default they go to console.error — on top of the TUI screen.
    setUnexpectedErrorHandler((e: unknown) => {
        bootstrapLogger.error(`unexpected error: ${describeRejection(e)}`);
    });

    // The profile registry comes first: the profile directory depends on it. Resolved like upstream:
    // `--profile` → workspace binding → Default.
    const { basePaths, applicationState, profilesService } = openProfiles(cli, profilesLogger, extensionsLogger);
    // Like upstream `deleteExtensionsNotInProfiles`: deleted on the next start, not under a running host.
    profilesService.onDidChangeProfiles((e) => {
        if (e.removed.length === 0) return;
        try {
            const marked = markUnusedExtensions(
                basePaths.extensionsDir,
                allProfileExtensionsFiles(profilesService),
                undefined,
                extensionsLogger,
            );
            if (marked.length > 0) {
                extensionsLogger.info("Extensions no profile uses will be removed on next start", {
                    marked: marked.map((e) => `${e.id}@${e.version}`),
                });
            }
        } catch (err) {
            extensionsLogger.error("Failed to mark extensions no profile uses", err);
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
    // Lives for the whole app lifetime; the OS releases the fd on exit.
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
    // `--disable-extensions` disables only user extensions, like VS Code: built-ins would take grammars and
    // language configurations with them. The profile is fixed per process: switching means a window reload and a rescan.
    // By directory, not id: several versions of one id may lie on disk, the profile entry picks one.
    const profileExtensionDirs = new Set(
        createProfileExtensions({
            extensionsDir: userDataPaths.extensionsDir,
            profile: activeProfile,
            profiles: profilesService,
            logger: extensionsLogger,
        })
            .list()
            .map((e) => path.basename(e.dir)),
    );
    const userExtensions =
        !cli.disableExtensions && fs.existsSync(userDataPaths.extensionsDir)
            ? (await scanExtensions(assets, USER_PREFIX, { isBuiltin: false }, extensionsLogger)).filter((e) =>
                  profileExtensionDirs.has(e.location.slice(USER_PREFIX.length, -1)),
              )
            : [];
    if (cli.disableExtensions) extensionsLogger.info("user extensions disabled by --disable-extensions");
    leaseUserExtensions(
        userDataPaths.extensionsDir,
        userExtensions.map((e) => e.location.slice(USER_PREFIX.length, -1)),
        extensionsLogger,
    );
    const allExtensions = mergeExtensions(builtinExtensions, userExtensions, extensionsLogger);
    mark("main:extensions-scanned", { builtin: builtinExtensions.length, user: userExtensions.length });

    // Extension scan before loading settings: the defaults layer is built from the full registry.
    const configurationRegistry = new ConfigurationRegistry(CONFIGURATION_CONTRIBUTIONS);
    new ExtensionConfigurationContributor(
        allExtensions,
        configurationRegistry,
        (ext) => (ext.isBuiltin ? builtinConfigInjection(ext.manifest.name) : curatedConfigInjection(ext.id)),
        extensionsLogger,
    ).apply();
    // The folder is set here already: the project's `.diode/settings.json` must apply from the first frame.
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
    // The service adopts the application storage: `storage.json` has a single writer.
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
    // Extension themes before picking the active one: the first frame is already in the `workbench.colorTheme`
    // theme, without Dark Modern.
    const themeRegistry = createBuiltinThemeRegistry();
    const themeContributor = new ExtensionThemeContributor(assets, allExtensions, themeRegistry, extensionsLogger);
    await themeContributor.apply();
    // The setting is left alone: if the extension comes back, so does its theme. With scheme detection the
    // terminal hasn't answered yet — the scheme it reported last time picks the key (HostColorSchemeService).
    const lastHostColorScheme = stateService.get(LAST_HOST_COLOR_SCHEME) ?? undefined;
    const colorThemeLabel = configurationService.get(getColorThemeSettingId(configurationService, lastHostColorScheme));
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
    // Before the first tokenization: token colors are indices into the theme's colorMap.
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
        // The marketplace takes the same source and directory as CLI install, otherwise the UI would show
        // something other than what the CLI installs.
        environment: createEnvironmentService(userDataPaths, cli),
        extensions: {
            host: { diode: DIODE_VERSION, vscode: VSCODE_SHIM_VERSION, targetPlatform: currentTargetPlatform() },
            onProblem: (problem) => {
                extensionsLogger.warn(problem);
            },
        },
        extensionHost: {
            // User extensions first, then built-in ones.
            extensions: [...userExtensions, ...builtinExtensions],
            registration: {
                userPrefix: USER_PREFIX,
                userExtensionsDir: userDataPaths.extensionsDir,
                readBuiltinSource: (virtualPath) => assets.readText(virtualPath),
            },
        },
        hostProcess: {
            exit: () => process.exit(0),
            // The next window's profile is always an explicit `--profile`: the old flag from argv would override the
            // binding just written. There is no hot reload of contributions — "apply" means "start over".
            restart: (relaunch) => {
                const current = profileWorkspaceKey(container.get(IWorkspaceContextServiceDIToken).getWorkspace());
                const next = relaunchArgs(process.argv.slice(2), {
                    profile: relaunch?.profile ?? activeProfile.name,
                    workspace: relaunchWorkspace(relaunch?.workspace, workspaceKey, current),
                });
                bootstrapLogger.info("reloading window", { args: next });
                // The first reload turns this process into the supervisor: it lives on, but loads nothing.
                releaseExtensionLease(userDataPaths.extensionsDir);
                restartProcess(currentProcessSnapshot(), realRestartHooks, next);
            },
        },
        userDataProfile: {
            profilesService,
            currentProfile: activeProfile,
            // OSC 0 directly, without tmux passthrough: tmux sets the pane title itself.
            terminalTitle: (title) => {
                backend.setWindowTitle(title);
            },
        },
    });
    mark("main:container-created");

    // The synchronous shutdown phase runs in reverse subscription order: subprocesses and the inspector go
    // before the terminal, session state goes to disk last.
    const lifecycle = container.get(LifecycleServiceDIToken);

    // The bootstrap folder was already read above — setting the same folder again is a no-op.
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

    // Safety net for paths that bypass shutdown (SIGINT in NodeTerminalBackend): only synchronous I/O on "exit".
    process.on("exit", () => {
        try {
            stateService.flushSync();
        } catch {
            /* nothing to do on exit — swallow */
        }
    });

    // Tokens carry colorMap indices of the previous theme — documents are retokenized, as in upstream.
    container.get(ThemeServiceDIToken).onThemeChange((theme) => {
        tokenizationContributor.setTheme(createTextMateTheme(theme));
        semanticTokenStyleResolver.setTheme(theme.tokenTheme);
    });

    const app = container.get(TuiApplicationDIToken);
    // Before the window starts: its subscriptions remember activation events that arrive before registration.
    const extensionService = container.get(ExtensionServiceDIToken);
    // Root before subscribing to the phases below: in `eventually` contributions are instantiated before grammar warm-up.
    container.get(WorkbenchComponentDIToken);

    lifecycle.onDidChangePhase((phase) => {
        if (phase === "eventually") void tokenizationContributor.preloadAll();
    });

    // The inspector's `Diode.whenReady` is the same moment as `complete: true` in the startup trace.
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
                // Port only to logService: stderr goes to the same pty and corrupts the rendering.
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
                                      // The protocol uses 0-based cells, terminal sequences are 1-based.
                                      headlessBackend.sendMouse({ ...params, x: params.x + 1, y: params.y + 1 });
                                  },
                                  resize: (cols, rows) => {
                                      headlessBackend.resize(new Size(cols, rows));
                                  },
                                  captureFrame: async () => {
                                      // Flush the frame deferred to setImmediate (scheduleRender).
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
                                      // Deferred so the RPC response gets out before exit.
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
                            clock: container.get(AdjustableClockDIToken),
                            ...(headlessBackend !== null ? { hostTerminal: headlessBackend } : {}),
                        },
                    );
                    // The port is released before exit: the reloaded window takes the same one.
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
                // Before the extension host spawn, but off the path to the first frame: on a cold cache
                // extraction is synchronous (~20 ms).
                void ensureTsServer((err) => {
                    extensionsLogger.error("bundled ts-server unpack failed", err);
                });
                const activation = extensionService.start();
                // `main:startup-complete` and `exthost:activated` don't wait for each other; the full trace (the bench waits
                // for `complete: true`) is written once both have happened.
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
 * Exit code via `process.exitCode`, not `process.exit()`: aborting while http sockets are closing
 * crashes libuv on Windows (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`).
 */
async function runExtensionManagement(cli: ICliArgs): Promise<void> {
    const { extensionsDir } = resolvePathsFor(cli);

    try {
        // Without `--profile` it is Default, like upstream `cliProcessMain`; the CLI doesn't touch workspace bindings.
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
            // By the `.vsix` suffix, like VS Code, not by the FS: a file in cwd named like an id would silently hijack
            // a registry install. `.vsix` needs the registry too: its dependencies come from there.
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
            // Upstream `installGivenVersion`: `id@version` and a `.vsix` pin the version in the profile.
            let givenVersion = true;
            if (target.endsWith(".vsix")) {
                const vsixPath = path.resolve(target);
                result = await installVsix(vsixPath, extensionsDir);
                const manifest = await readVsixManifest(vsixPath);
                if (readExtensionDependencies(manifest).length > 0) {
                    try {
                        dependencies = await installDependenciesFromRegistry(registry(), result.id, manifest, options);
                    } catch (err) {
                        // Like VS Code for VSIX: a dependency failure is a warning, not a failed install.
                        console.error(`Warning: ${err instanceof Error ? err.message : String(err)}`);
                    }
                }
            } else {
                const [extensionId, version] = getIdAndVersion(target);
                givenVersion = version !== undefined;
                const current = profileExtensions
                    .list()
                    .find((e) => extensionKey(e.id) === extensionKey(extensionId) && e.version === version);
                if (current !== undefined) {
                    // Upstream says the same without `--force`; deviation (decision D4): the entry gets pinned.
                    profileExtensions.add([current], { pinned: true });
                    console.log(`Extension '${extensionId}@${current.version}' is already installed.`);
                    return;
                }
                const installed = await installFromRegistry(registry(), extensionId, { ...options, version });
                result = installed;
                dependencies = installed;
            }
            // Into the profile, together with dependencies, including those already on disk for another profile.
            const { obsolete } = profileExtensions.add([result], {
                ...(givenVersion ? { pinned: true } : {}),
                dependencies: dependencies.dependencies,
            });
            const { id, version } = result;
            console.log(`Installed ${id}@${version}`);
            // Not deleted here: a running window may still load files from them. The CLI never deletes (decision V1).
            const previous = obsolete.filter((e) => extensionKey(e.id) === extensionKey(id)).map((e) => e.version);
            if (previous.length > 0) {
                console.log(`Previous version(s) will be removed on next start: ${previous.join(", ")}`);
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
 * The CLI and the editor must look at the same extensions directory. `profileId` is the profile directory
 * from the registry, not the name from `--profile`.
 */
function resolvePathsFor(cli: ICliArgs, profileId?: string): IUserDataPaths {
    return resolveUserDataPaths({
        userDataDir: cli.userDataDir,
        profile: profileId,
        homedir: os.homedir(),
        ...(cli.extensionsDir !== undefined ? { extensionsDir: cli.extensionsDir } : {}),
    });
}

/**
 * A failure migrating the extension set goes to the log: it does not break startup. With `extensionsLogger` (the
 * editor, never the CLI) also deletes the versions marked for removal, before anything scans extensions.
 */
function openProfiles(cli: ICliArgs, logger?: ILogger, extensionsLogger?: ILogger) {
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
    if (extensionsLogger !== undefined) {
        try {
            cleanUpExtensions(basePaths.extensionsDir, {
                referencedDirs: () =>
                    referencedExtensionDirs(basePaths.extensionsDir, allProfileExtensionsFiles(profilesService)),
                logger: extensionsLogger,
            });
        } catch (err) {
            extensionsLogger.error("Failed to delete extensions marked for removal", err);
        }
    }
    return { basePaths, applicationState, profilesService };
}

/**
 * Decision V1: another window's cleanup must not delete what this process loaded. Released on exit and
 * on reload; a crash leaves a lease of a dead pid, which the next cleanup drops.
 */
function leaseUserExtensions(extensionsDir: string, dirs: readonly string[], logger: ILogger): void {
    if (dirs.length === 0) return;
    try {
        writeExtensionLease(extensionsDir, dirs);
    } catch (err) {
        logger.warn("Failed to lease the loaded extensions", err);
        return;
    }
    process.on("exit", () => {
        try {
            releaseExtensionLease(extensionsDir);
        } catch {
            /* nothing to do on exit — swallow */
        }
    });
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

/** A function, not a const: `main()` runs before the declarations at the module bottom — a `const` would be in TDZ. */
function nodeWorkspaceFileReader(): IWorkspaceFileReader {
    return {
        readText: (filePath) => fs.promises.readFile(filePath, "utf-8"),
        isDirectory: (filePath) => Promise.resolve(isExistingDirectory(filePath)),
    };
}

/** `load()` never rejects: a broken grammar leaves the language on the fallback, startup does not fail. */
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
 * Extraction paths of the bundled tsserver are determined by the version and the bundle hash, so they are handed
 * out before extraction (which happens in `startExtensions`, after the first frames).
 */
function builtinConfigInjection(manifestName: string): Record<string, unknown> {
    if (manifestName !== "diode-lsp-typescript") return {};
    const target = bundledTsServerTarget();
    if (target === null) return {};
    return {
        "diode.lsp.typescript.bundledServerPath": target.serverPath,
        "diode.lsp.typescript.bundledTsserverPath": target.tsserverPath,
        // SEA: the server runs on our own binary in node mode (runAsNode.ts);
        // dev/self-extract: the subprocess's process.execPath is real node.
        "diode.lsp.typescript.serverRuntime": isSeaBinary() ? "diode-as-node" : "node",
    };
}
