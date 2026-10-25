import { randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import * as path from "node:path";

import type { TuiApplication } from "@tuidom/core/dom/tuiApplication";
import { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";

import { FakeExtensionPtySession } from "../../../TestUtils/FakeExtensionPtySession.ts";
import { FakeTerminalSurface } from "../../../TestUtils/FakeTerminalSurface.ts";
import { DIODE_VERSION } from "../../base/common/version.ts";
import { NULL_LANGUAGE_CONFIGURATION_SERVICE } from "../../editor/common/languages/iLanguageConfigurationService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../editor/common/languages/tokenizationRegistry.ts";
import type { IEnvironmentService } from "../../platform/environment/common/environment.ts";
import { currentTargetPlatform } from "../../platform/extensionManagement/node/targetPlatform.ts";
import { Container } from "../../platform/instantiation/common/diContainer.ts";
import { TuiApplicationDIToken } from "../../platform/layout/browser/tuiApplicationDIToken.ts";
import { StateFileStore } from "../../platform/state/node/stateService.ts";
import { WorkbenchTheme } from "../../platform/theme/common/workbenchTheme.ts";
import { UserDataProfilesService } from "../../platform/userDataProfile/node/userDataProfilesService.ts";
import { VSCODE_SHIM_VERSION } from "../../workbench/api/common/vscodeShimVersion.ts";
import {
    ProblemMatcherRegistry,
    ProblemMatcherRegistryDIToken,
} from "../../workbench/contrib/tasks/common/problemMatcherRegistry.ts";
import { DefaultShellResolverDIToken } from "../../workbench/contrib/terminal/common/defaultShell.ts";
import {
    ExtensionPtySessionFactoryDIToken,
    TerminalSessionFactoryDIToken,
} from "../../workbench/contrib/terminal/common/terminalSessionFactory.ts";
import { terminalEnvironmentModule } from "../../workbench/services/terminalEnvironment/node/terminalEnvironmentModule.ts";
import { darkPlusTheme } from "../../workbench/services/themes/common/themes/darkPlus.ts";

import { backendModuleDefault } from "./backendModule.ts";
import { commandsModule } from "./commandsModule.ts";
import { configurationModuleDefault } from "./configurationModule.ts";
import { coreModuleLate } from "./coreModule.ts";
import { environmentModule } from "./environmentModule.ts";
import { extensionsModule } from "./extensionsModule.ts";
import { filesModule } from "./filesModule.ts";
import { fileWatcherModuleDefault } from "./fileWatcherModule.ts";
import { keybindingsModuleDefault } from "./keybindingsModule.ts";
import { lifecycleModule } from "./lifecycleModule.ts";
import { loggingModuleDefault } from "./loggingModule.ts";
import { markersModule } from "./markersModule.ts";
import { preferencesModule } from "./preferencesModule.ts";
import { stateModuleDefault } from "./stateModule.ts";
import { themeModule } from "./themeModule.ts";
import { tokenizationModule } from "./tokenizationModule.ts";
import { userDataProfileModule } from "./userDataProfileModule.ts";
import { workbenchModule } from "./workbenchModule.ts";
import { workspaceModule } from "./workspaceModule.ts";

/**
 * `TuiApplicationDIToken` is bound later via `bindApp(testApp.app)`: after `workbench.mount()` and
 * `TestApp.create(workbench.view, size)`.
 */
export interface TestContainerHandle {
    container: Container;
    bindApp: (app: TuiApplication) => void;
}

/** A temp directory per container; nothing hits the network (`registry` is a path, not the public marketplace). */
export function createTestEnvironment(): IEnvironmentService {
    const root = path.join(tmpdir(), `diode-tests-${randomUUID()}`);
    const profileDir = path.join(root, "user-data", "User");
    return {
        userDataRoot: root,
        extensionsDir: path.join(root, "extensions"),
        logsDir: path.join(root, "user-data", "logs"),
        registry: path.join(root, "no-registry"),
        userHome: homedir(),
        settingsResource: path.join(profileDir, "settings.json"),
        keybindingsResource: path.join(profileDir, "keybindings.json"),
        globalStorageDir: path.join(profileDir, "globalStorage"),
        workspaceStorageDir: path.join(profileDir, "workspaceStorage"),
        secretsFile: path.join(profileDir, "secrets.json"),
    };
}

export interface TestContainerOptions {
    /** Overrides for test environment fields (e.g. a settings.json path in the test's directory). */
    readonly environment?: Partial<IEnvironmentService>;
}

export function createTestContainer(options: TestContainerOptions = {}): TestContainerHandle {
    const environment = { ...createTestEnvironment(), ...options.environment };
    // A real profiles registry, but over an in-memory store and the test environment's
    // directory: profile commands create directories alongside everything else.
    const userDir = path.join(environment.userDataRoot, "user-data", "User");
    const profilesService = new UserDataProfilesService({
        profilesHome: path.join(userDir, "profiles"),
        defaultProfileHome: userDir,
        // The Default profile's extension list lives in the extensions directory, as in production.
        defaultProfileExtensionsResource: path.join(environment.extensionsDir, "extensions.json"),
        state: new StateFileStore(undefined),
    });
    const container = new Container()
        .use(environmentModule, environment)
        .use(userDataProfileModule, { profilesService, currentProfile: profilesService.defaultProfile })
        .use(coreModuleLate)
        .use(loggingModuleDefault)
        .use(commandsModule)
        .use(themeModule, { theme: WorkbenchTheme.fromThemeFile(darkPlusTheme) })
        .use(backendModuleDefault)
        .use(tokenizationModule, {
            tokenizationRegistry: new TokenizationRegistry(),
            tokenStyleResolver: NULL_TOKEN_STYLE_RESOLVER,
            languageService: NULL_LANGUAGE_SERVICE,
            languageConfigurationService: NULL_LANGUAGE_CONFIGURATION_SERVICE,
        })
        .use(configurationModuleDefault)
        .use(stateModuleDefault)
        .use(terminalEnvironmentModule, { backend: new MockTerminalBackend() })
        .use(keybindingsModuleDefault)
        .use(workspaceModule)
        .use(fileWatcherModuleDefault)
        .use(filesModule)
        .use(markersModule)
        .use(workbenchModule)
        // Exit and window reload are no-ops in tests: the real ones would take down
        // the runner. A test that cares about the call overrides the binding.
        .use(lifecycleModule, {
            hostProcess: {
                exit: () => {
                    /* no-op */
                },
                restart: () => {
                    /* no-op */
                },
            },
        })
        // Marketplace: the same production wiring as the app, but over test environment
        // paths that do not exist. No separate "empty" marketplace for tests — it would
        // drift from the real one.
        .use(extensionsModule, {
            host: { diode: DIODE_VERSION, vscode: VSCODE_SHIM_VERSION, targetPlatform: currentTargetPlatform() },
        })
        .use(preferencesModule);

    // Tests never spawn real PTYs: each call returns a fresh FakeTerminalSurface. Tests that
    // need the created instances override the binding locally with their own factory.
    container.bind(TerminalSessionFactoryDIToken, () => () => new FakeTerminalSurface());
    // Extension pty terminals: the same fake surface with a `feed` input.
    container.bind(ExtensionPtySessionFactoryDIToken, () => (options) => new FakeExtensionPtySession(options));
    // No extension host here: no extension contributes problem matchers, and tasks need not wait for one.
    container.bind(ProblemMatcherRegistryDIToken, () => {
        const registry = new ProblemMatcherRegistry();
        registry.registerExtensions([], () => undefined);
        return registry;
    });
    // Fixed task shell: tests must not depend on the machine's $SHELL.
    container.bind(DefaultShellResolverDIToken, () => () => "/bin/bash");

    return {
        container,
        bindApp: (app) => {
            container.bind(TuiApplicationDIToken, () => app);
        },
    };
}
