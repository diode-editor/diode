import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import * as path from "node:path";

import type { TuiApplication } from "@tuidom/core/dom/tuiApplication";
import { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";

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
import { WorkbenchTheme } from "../../platform/theme/common/workbenchTheme.ts";
import { VSCODE_SHIM_VERSION } from "../../workbench/api/common/vscodeShimVersion.ts";
import { TerminalSessionFactoryDIToken } from "../../workbench/contrib/terminal/common/terminalSessionFactory.ts";
import { terminalEnvironmentModule } from "../../workbench/services/terminalEnvironment/node/terminalEnvironmentModule.ts";
import { darkPlusTheme } from "../../workbench/services/themes/common/themes/darkPlus.ts";

import { backendModuleDefault } from "./backendModule.ts";
import { commandsModule } from "./commandsModule.ts";
import { configurationModuleDefault } from "./configurationModule.ts";
import { coreModuleLate } from "./coreModule.ts";
import { environmentModule } from "./environmentModule.ts";
import { extensionsModule } from "./extensionsModule.ts";
import { fileWatcherModuleDefault } from "./fileWatcherModule.ts";
import { keybindingsModuleDefault } from "./keybindingsModule.ts";
import { lifecycleModule } from "./lifecycleModule.ts";
import { loggingModuleDefault } from "./loggingModule.ts";
import { markersModule } from "./markersModule.ts";
import { preferencesModule } from "./preferencesModule.ts";
import { stateModuleDefault } from "./stateModule.ts";
import { themeModule } from "./themeModule.ts";
import { tokenizationModule } from "./tokenizationModule.ts";
import { workbenchModule } from "./workbenchModule.ts";
import { workspaceModule } from "./workspaceModule.ts";

/**
 * Тестовый контейнер. Возвращает контейнер с подключёнными NULL-стабами для
 * tokenization/language и `darkPlusTheme`. `TuiApplicationDIToken` биндится
 * **позже** через `bindApp(testApp.app)` — порядок такой:
 *
 *     const { container, bindApp } = createTestContainer();
 *     const workbench = container.get(WorkbenchComponentDIToken);
 *     workbench.mount();
 *     const testApp = TestApp.create(workbench.view, size);
 *     bindApp(testApp.app);
 */
export interface TestContainerHandle {
    container: Container;
    bindApp: (app: TuiApplication) => void;
}

/**
 * Окружение тестов: полное, как в приложении, но в своём временном каталоге на
 * каждый контейнер, которого на диске нет. Реестр расширений не читается, каталог
 * установленного пуст, в сеть никто не ходит (`registry` — путь, а не публичный
 * магазин); команда, которая что-то пишет в user data (Open Settings), пишет
 * сюда — каталог убирает за собой харнесс.
 */
export function createTestEnvironment(): IEnvironmentService {
    const root = path.join(tmpdir(), `diode-tests-${randomUUID()}`);
    const profileDir = path.join(root, "user-data", "User");
    return {
        userDataRoot: root,
        extensionsDir: path.join(root, "extensions"),
        logsDir: path.join(root, "user-data", "logs"),
        registry: path.join(root, "no-registry"),
        settingsResource: path.join(profileDir, "settings.json"),
        keybindingsResource: path.join(profileDir, "keybindings.json"),
        globalStorageDir: path.join(profileDir, "globalStorage"),
        workspaceStorageDir: path.join(profileDir, "workspaceStorage"),
        secretsFile: path.join(profileDir, "secrets.json"),
    };
}

export interface TestContainerOptions {
    /** Перебить поля тестового окружения (например путь settings.json в каталоге теста). */
    readonly environment?: Partial<IEnvironmentService>;
}

export function createTestContainer(options: TestContainerOptions = {}): TestContainerHandle {
    const container = new Container()
        .use(environmentModule, { ...createTestEnvironment(), ...options.environment })
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
        .use(markersModule)
        .use(workbenchModule)
        // Выход и перезагрузка окна в тестах — no-op: настоящие унесли бы
        // раннер. Тест, которому важен сам вызов, перебивает биндинг.
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
        // Магазин — та же продовая проводка, что в приложении, но по путям
        // тестового окружения, которых нет. Отдельного «пустого» магазина для
        // тестов не держим — он расходился бы с настоящим.
        .use(extensionsModule, {
            host: { diode: DIODE_VERSION, vscode: VSCODE_SHIM_VERSION, targetPlatform: currentTargetPlatform() },
        })
        .use(preferencesModule);

    // Перебиваем прод-фабрику терминальных сессий на фейк: тесты не спавнят реальные
    // PTY. Каждый вызов возвращает свежий FakeTerminalSurface; тесты, которым нужен
    // доступ к созданным инстансам, перебивают биндинг локально своей фабрикой.
    container.bind(TerminalSessionFactoryDIToken, () => () => new FakeTerminalSurface());

    return {
        container,
        bindApp: (app) => {
            container.bind(TuiApplicationDIToken, () => app);
        },
    };
}
