import type { ITerminalBackend } from "@tuidom/core/backend/iTerminalBackend";
import type { TuiApplication } from "@tuidom/core/dom/tuiApplication";
import type { ILanguageService } from "../../editor/common/languages/iLanguageService.ts";
import type { ITokenStyleResolver } from "../../editor/common/languages/iTokenStyleResolver.ts";
import type { TokenizationRegistry } from "../../editor/common/languages/tokenizationRegistry.ts";
import type { IClipboard } from "../../platform/clipboard/common/iClipboard.ts";
import type { ConfigurationRegistry } from "../../platform/configuration/common/configurationRegistry.ts";
import type { IConfigurationService } from "../../platform/configuration/common/iConfigurationService.ts";
import { Container } from "../../platform/instantiation/common/diContainer.ts";
import type { IUserKeybindingRule } from "../../platform/keybinding/node/keybindingsService.ts";
import type { ILogService } from "../../platform/log/common/iLogService.ts";
import type { ILogHistory } from "../../workbench/services/output/common/output.ts";
import type { IStateService } from "../../platform/state/common/iStateService.ts";
import type { WorkbenchTheme } from "../../platform/theme/common/workbenchTheme.ts";
import { terminalEnvironmentModule } from "../../workbench/services/terminalEnvironment/node/terminalEnvironmentModule.ts";
import type { ThemeRegistry } from "../../workbench/services/themes/common/themeRegistry.ts";

import { backendModule } from "./backendModule.ts";
import { commandsModule } from "./commandsModule.ts";
import { configurationModule } from "./configurationModule.ts";
import { coreModule } from "./coreModule.ts";
import { extensionHostModule } from "./extensionHostModule.ts";
import { fileWatcherModule } from "./fileWatcherModule.ts";
import { keybindingsModule } from "./keybindingsModule.ts";
import { loggingModule } from "./loggingModule.ts";
import { markersModule } from "./markersModule.ts";
import { stateModule } from "./stateModule.ts";
import { themeModule } from "./themeModule.ts";
import { tokenizationModule } from "./tokenizationModule.ts";
import { workbenchModule } from "./workbenchModule.ts";
import { workspaceModule } from "./workspaceModule.ts";

export interface ProductionProfileContext {
    app: TuiApplication;
    backend: ITerminalBackend;
    theme: WorkbenchTheme;
    themeRegistry: ThemeRegistry;
    clipboard: IClipboard;
    tokenizationRegistry: TokenizationRegistry;
    tokenStyleResolver: ITokenStyleResolver;
    languageService: ILanguageService;
    configurationService: IConfigurationService;
    configurationRegistry: ConfigurationRegistry;
    stateService: IStateService;
    userKeybindings: readonly IUserKeybindingRule[];
    logService: ILogService;
    /** Кольцевой буфер логов — источник содержимого Output-панели. */
    logHistory: ILogHistory;
    /** Absolute path of the active-profile Vexx settings.json (for diagnostics scoping). */
    settingsResource: string;
    /** Absolute path of the active-profile Vexx keybindings.json (for the open-keybindings command). */
    keybindingsResource: string;
}

/**
 * Production-профиль: полный набор сервисов с реальными реализациями
 * tokenization/language. Используется в `main.ts`.
 */
export function createProductionContainer(ctx: ProductionProfileContext): Container {
    return new Container()
        .use(coreModule, { app: ctx.app })
        .use(loggingModule, { logService: ctx.logService, logHistory: ctx.logHistory })
        .use(commandsModule)
        .use(themeModule, { theme: ctx.theme, themeRegistry: ctx.themeRegistry })
        .use(backendModule, { clipboard: ctx.clipboard })
        .use(tokenizationModule, {
            tokenizationRegistry: ctx.tokenizationRegistry,
            tokenStyleResolver: ctx.tokenStyleResolver,
            languageService: ctx.languageService,
        })
        .use(configurationModule, {
            configurationService: ctx.configurationService,
            configurationRegistry: ctx.configurationRegistry,
        })
        .use(stateModule, { stateService: ctx.stateService })
        .use(terminalEnvironmentModule, { backend: ctx.backend })
        .use(keybindingsModule, { rules: ctx.userKeybindings })
        .use(workspaceModule)
        .use(fileWatcherModule)
        .use(markersModule, { settingsResource: ctx.settingsResource, keybindingsResource: ctx.keybindingsResource })
        .use(workbenchModule)
        .use(extensionHostModule);
}
