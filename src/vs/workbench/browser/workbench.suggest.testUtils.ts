import type { CompletionListElement } from "@tuidom/all/ui/completionlist/completionListElement";
import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import type { TestApp } from "../../../TestUtils/TestApp.ts";
import type { ContextKeyService } from "../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { CompletionServiceDIToken } from "../contrib/suggest/browser/completionService.ts";
import type { SuggestComponent } from "../contrib/suggest/browser/suggestComponent.ts";
import { SuggestComponentDIToken } from "../contrib/suggest/browser/suggestComponent.ts";

import type { TextEditorPane } from "./parts/editor/textEditorPane.ts";
import type { WorkbenchComponent } from "./workbenchComponent.ts";

/** Срез пары CompletionService+SuggestComponent для интеграционных тестов. */
export interface SuggestHandle {
    trigger(): Promise<void>;
    isOpen(): boolean;
    readonly view: CompletionListElement;
}

export interface SuggestContext {
    testApp: TestApp;
    /** Сам компонент попапа — для проверок панели описания. */
    component: SuggestComponent;
    workbench: WorkbenchComponent;
    contextKeys: ContextKeyService;
    activeEditor: () => TextEditorPane;
    completion: SuggestHandle;
    harness: IAppHarness;
    workspace: ITempWorkspace;
}

/** Boots a full Workbench over a real temp file with the editor focused. */
export function createSuggestApp(text: string): SuggestContext {
    const workspace = createTempWorkspace({ prefix: "vexx-suggest-app-", files: { "file.txt": text } });
    const harness = createAppTestHarness({
        openFile: workspace.path("file.txt"),
        focusEditor: true,
    });

    // Тот же синглтон-инстанс, что резолвил Workbench (контейнер кэширует).
    const service = harness.container.get(CompletionServiceDIToken);
    const component = harness.container.get(SuggestComponentDIToken);
    const view = component.view;
    const completion: SuggestHandle = {
        trigger: () => service.trigger(),
        isOpen: () => service.isOpen(),
        view,
    };

    return {
        testApp: harness.testApp,
        component,
        workbench: harness.workbench,
        contextKeys: harness.container.get(ContextKeyServiceDIToken),
        activeEditor: () => harness.activeEditor(),
        completion,
        harness,
        workspace,
    };
}

export function disposeSuggestApp(ctx: SuggestContext): void {
    ctx.harness.dispose();
    ctx.workspace.dispose();
}
