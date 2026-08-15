import { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import type { TuiApplication } from "@tuidom/core/dom/tuiApplication";
import { FakeTerminalSurface } from "../../../TestUtils/FakeTerminalSurface.ts";
import { NULL_LANGUAGE_SERVICE } from "../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../editor/common/languages/tokenizationRegistry.ts";
import { Container } from "../../platform/instantiation/common/diContainer.ts";
import { WorkbenchTheme } from "../../platform/theme/common/workbenchTheme.ts";
import { TuiApplicationDIToken } from "../../workbench/common/coreTokens.ts";
import { TerminalSessionFactoryDIToken } from "../../workbench/contrib/terminal/common/terminalSessionFactory.ts";
import { terminalEnvironmentModule } from "../../workbench/services/terminalEnvironment/node/terminalEnvironmentModule.ts";
import { darkPlusTheme } from "../../workbench/services/themes/common/themes/darkPlus.ts";

import { backendModuleDefault } from "./backendModule.ts";
import { commandsModule } from "./commandsModule.ts";
import { configurationModuleDefault } from "./configurationModule.ts";
import { coreModuleLate } from "./coreModule.ts";
import { fileWatcherModuleDefault } from "./fileWatcherModule.ts";
import { keybindingsModuleDefault } from "./keybindingsModule.ts";
import { loggingModuleDefault } from "./loggingModule.ts";
import { markersModule } from "./markersModule.ts";
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

export function createTestContainer(): TestContainerHandle {
    const container = new Container()
        .use(coreModuleLate)
        .use(loggingModuleDefault)
        .use(commandsModule)
        .use(themeModule, { theme: WorkbenchTheme.fromThemeFile(darkPlusTheme) })
        .use(backendModuleDefault)
        .use(tokenizationModule, {
            tokenizationRegistry: new TokenizationRegistry(),
            tokenStyleResolver: NULL_TOKEN_STYLE_RESOLVER,
            languageService: NULL_LANGUAGE_SERVICE,
        })
        .use(configurationModuleDefault)
        .use(stateModuleDefault)
        .use(terminalEnvironmentModule, { backend: new MockTerminalBackend() })
        .use(keybindingsModuleDefault)
        .use(workspaceModule)
        .use(fileWatcherModuleDefault)
        .use(markersModule, { settingsResource: null, keybindingsResource: null })
        .use(workbenchModule);

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
