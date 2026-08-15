import { Size } from "@tuidom/core/common/geometryPromitives";
import type { CommandRegistry } from "../vs/platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../vs/platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../vs/platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../vs/platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { Container } from "../vs/platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../vs/platform/state/common/iStateService.ts";
import { createTestContainer } from "../vs/vexx/modules/testProfile.ts";
import type { TextEditorPane } from "../vs/workbench/browser/parts/editor/textEditorPane.ts";
import type { WorkbenchComponent } from "../vs/workbench/browser/workbenchComponent.ts";
import { WorkbenchComponentDIToken } from "../vs/workbench/browser/workbenchComponent.ts";
import {
    KeybindingsResourceDIToken,
    SettingsResourceDIToken,
    StateServiceDIToken,
} from "../vs/workbench/common/coreTokens.ts";
import { EditorServiceDIToken } from "../vs/workbench/services/editor/browser/editorService.ts";

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
    /** Переопределить путь settings.json (по умолчанию `null` из TestProfile). */
    readonly settingsResource?: string;
    /** Переопределить путь keybindings.json (по умолчанию `null` из TestProfile). */
    readonly keybindingsResource?: string;
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
    const { container, bindApp } = createTestContainer();
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
    if (options.settingsResource !== undefined) {
        const resource = options.settingsResource;
        container.bind(SettingsResourceDIToken, () => resource);
    }
    if (options.keybindingsResource !== undefined) {
        const resource = options.keybindingsResource;
        container.bind(KeybindingsResourceDIToken, () => resource);
    }
    options.containerOverrides?.(container);
    const workbench = container.get(WorkbenchComponentDIToken);
    if (options.workspaceFolder !== undefined) {
        workbench.setWorkspaceFolder(options.workspaceFolder);
    }
    workbench.mount();
    const testApp = TestApp.create(workbench.view, options.size ?? new Size(80, 24));
    bindApp(testApp.app);

    if (options.openFile !== undefined) {
        workbench.openFile(options.openFile);
    }
    if (options.focusEditor === true) {
        workbench.focusEditor();
        testApp.render();
    }

    const group = container.get(EditorServiceDIToken);
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
        },
    };
}
