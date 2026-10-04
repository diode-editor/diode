import * as fs from "node:fs";

import { Size } from "@tuidom/core/common/geometryPromitives";

import { createTestContainer } from "../vs/diode/modules/testProfile.ts";
import type { CommandRegistry } from "../vs/platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../vs/platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../vs/platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../vs/platform/configuration/common/iConfigurationServiceDIToken.ts";
import { type IEnvironmentService, IEnvironmentServiceDIToken } from "../vs/platform/environment/common/environment.ts";
import type { Container } from "../vs/platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../vs/platform/state/common/iStateService.ts";
import { StateServiceDIToken } from "../vs/platform/state/common/iStateService.ts";
import { computeThemeVars } from "../vs/platform/theme/browser/themeStyleVars.ts";
import type { TextEditorPane } from "../vs/workbench/browser/parts/editor/textEditorPane.ts";
import type { WorkbenchComponent } from "../vs/workbench/browser/workbenchComponent.ts";
import { WorkbenchComponentDIToken } from "../vs/workbench/browser/workbenchComponent.ts";
import { EditorServiceDIToken } from "../vs/workbench/services/editor/common/editorService.ts";
import { ThemeServiceDIToken } from "../vs/workbench/services/themes/common/themeTokens.ts";

import { TestApp } from "./TestApp.ts";

export interface IAppHarnessOptions {
    /** Передаётся в `workbench.setWorkspaceFolder()` перед mount. Omit — путь «без воркспейса». */
    readonly workspaceFolder?: string;
    /** Размер терминала; по умолчанию 80×24. */
    readonly size?: Size;
    /** Абсолютный путь файла, который открыть после mount (`workbench.openFile`). */
    readonly openFile?: string;
    /** Сфокусировать редактор и отрендерить кадр после boot'а. */
    readonly focusEditor?: boolean;
    /** Реальный {@link IStateService} для тестов персистентности; по умолчанию NULL (не персистит). */
    readonly stateService?: IStateService;
    /**
     * Реальный {@link IConfigurationService} — для тестов live-apply настроек;
     * по умолчанию `NULL_CONFIGURATION_SERVICE` (событий не шлёт). Перебивает
     * биндинг ДО резолва WorkbenchComponent, так что и WorkbenchComponent, и
     * EditorService получают один и тот же экземпляр.
     */
    readonly configurationService?: IConfigurationService;
    /**
     * Перебить поля окружения (например `settingsResource`/`keybindingsResource`)
     * поверх тестового окружения профиля — пути во временном каталоге.
     */
    readonly environment?: Partial<IEnvironmentService>;
    /**
     * Произвольная перебивка биндингов ДО резолва `WorkbenchComponent` — для
     * сервисов, у которых нет своей именованной опции (например настоящий
     * `ILogService` + `LogHistory` вместо null-сервисов профиля тестов).
     */
    readonly containerOverrides?: (container: Container) => void;
}

export interface IAppHarness {
    readonly testApp: TestApp;
    readonly workbench: WorkbenchComponent;
    readonly commands: CommandRegistry;
    /** Полный контейнер — для suite-specific сервисов: `h.container.get(ThemeServiceDIToken)`. */
    readonly container: Container;
    /** Активный редактор группы; бросает, если его нет. */
    activeEditor(): TextEditorPane;
    /** `workbench.dispose()`. Воркспейсом НЕ владеет — композиция с {@link createTempWorkspace}. */
    dispose(): void;
}

/**
 * Boot-харнесс интеграционных тестов над {@link WorkbenchComponent}: тестовый
 * DI-контейнер → workbench → mount → {@link TestApp} → bindApp. Канонический вид:
 *
 *     beforeEach(() => {
 *         ws = createTempWorkspace({ files: { "alpha.txt": "Alpha" } });
 *         h = createAppTestHarness({ workspaceFolder: ws.dir });
 *     });
 *     afterEach(() => { h.dispose(); ws.dispose(); });
 *
 * Харнесс синхронный: async-активация (`await workbench.activate()` +
 * `fileIndexReady`) остаётся в тесте поверх харнесса.
 */
export function createAppTestHarness(options: IAppHarnessOptions = {}): IAppHarness {
    const { container, bindApp } = createTestContainer({ environment: options.environment });
    // Rebind before the WorkbenchComponent is resolved (it reads these at construction).
    // По умолчанию состояние не персистится (NULL_STATE_SERVICE из stateModuleDefault);
    // тест может подсунуть реальный StateService, перебив биндинг ДО резолва WorkbenchComponent.
    if (options.stateService !== undefined) {
        const stateService = options.stateService;
        container.bind(StateServiceDIToken, () => stateService);
    }
    if (options.configurationService !== undefined) {
        const configurationService = options.configurationService;
        container.bind(IConfigurationServiceDIToken, () => configurationService);
    }
    options.containerOverrides?.(container);
    const workbench = container.get(WorkbenchComponentDIToken);
    if (options.workspaceFolder !== undefined) {
        workbench.setWorkspaceFolder(options.workspaceFolder);
    }
    workbench.mount();
    // Палитра корня — от активной темы контейнера (по умолчанию Dark+ тестового
    // профиля), а не фиксированный Dark+: тест, подменивший ThemeService, видит
    // свою тему в первом же кадре — как приложение.
    const testApp = TestApp.create(
        workbench.view,
        options.size ?? new Size(80, 24),
        computeThemeVars(container.get(ThemeServiceDIToken).theme),
    );
    bindApp(testApp.app);

    if (options.openFile !== undefined) {
        workbench.openFile(options.openFile);
    }
    if (options.focusEditor === true) {
        workbench.focusEditor();
        testApp.render();
    }

    const group = container.get(EditorServiceDIToken);
    const { userDataRoot } = container.get(IEnvironmentServiceDIToken);
    return {
        testApp,
        workbench,
        commands: container.get(CommandRegistryDIToken),
        container,
        activeEditor: () => {
            const editor = group.getActiveEditor();
            /* v8 ignore start -- test helper: сценарий обязан открыть редактор до обращения к нему */
            if (editor === null) throw new Error("expected an active editor");
            /* v8 ignore stop */
            return editor;
        },
        dispose: () => {
            workbench.dispose();
            // Каталог user data тестового окружения: его создаёт только команда,
            // что-то записавшая в user data (Open Settings и т.п.).
            fs.rmSync(userDataRoot, { recursive: true, force: true });
        },
    };
}
