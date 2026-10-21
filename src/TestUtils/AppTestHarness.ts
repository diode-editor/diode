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
import { LifecycleServiceDIToken } from "../vs/workbench/services/lifecycle/browser/lifecycleService.ts";
import { ThemeServiceDIToken } from "../vs/workbench/services/themes/common/themeTokens.ts";

import { TestApp } from "./TestApp.ts";

export interface IAppHarnessOptions {
    readonly workspaceFolder?: string;
    readonly size?: Size;
    readonly openFile?: string;
    readonly focusEditor?: boolean;
    /** `ready` — остановиться сразу после `mount()`, до `afterRestored`. */
    readonly phase?: "ready" | "eventually";
    readonly stateService?: IStateService;
    readonly configurationService?: IConfigurationService;
    readonly environment?: Partial<IEnvironmentService>;
    readonly containerOverrides?: (container: Container) => void;
}

export interface IAppHarness {
    readonly testApp: TestApp;
    readonly workbench: WorkbenchComponent;
    readonly commands: CommandRegistry;
    readonly container: Container;
    activeEditor(): TextEditorPane;
    /** Воркспейсом не владеет — его освобождает {@link createTempWorkspace}. */
    dispose(): void;
}

/** Синхронный: `await workbench.activate()` и `fileIndexReady` остаются в тесте. */
export function createAppTestHarness(options: IAppHarnessOptions = {}): IAppHarness {
    const { container, bindApp } = createTestContainer({ environment: options.environment });
    // Перебивки — до резолва WorkbenchComponent: он читает их в конструкторе.
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
    // От темы контейнера, а не фиксированный Dark+: подменённый ThemeService виден в первом кадре.
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
    container.get(LifecycleServiceDIToken).setPhase(options.phase ?? "eventually");

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
            fs.rmSync(userDataRoot, { recursive: true, force: true });
        },
    };
}
