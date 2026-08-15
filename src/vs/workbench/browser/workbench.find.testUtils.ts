import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { typeText } from "../../../TestUtils/domQueries.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import type { TestApp } from "../../../TestUtils/TestApp.ts";
import type { ContextKeyService } from "../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";

import type { TextEditorPane } from "./parts/editor/textEditorPane.ts";
import type { WorkbenchComponent } from "./workbenchComponent.ts";

export interface FindContext {
    testApp: TestApp;
    workbench: WorkbenchComponent;
    contextKeys: ContextKeyService;
    activeEditor: () => TextEditorPane;
    tmpDir: string;
    harness: IAppHarness;
    workspace: ITempWorkspace;
}

/** Boots a full Workbench over a real temp file with the editor focused. */
export function createFindApp(text: string): FindContext {
    const workspace = createTempWorkspace({ prefix: "diode-find-app-", files: { "file.txt": text } });
    const harness = createAppTestHarness({
        openFile: workspace.path("file.txt"),
        focusEditor: true,
    });

    return {
        testApp: harness.testApp,
        workbench: harness.workbench,
        contextKeys: harness.container.get(ContextKeyServiceDIToken),
        activeEditor: () => harness.activeEditor(),
        tmpDir: workspace.dir,
        harness,
        workspace,
    };
}

/** Types each character into the focused find input. */
export function type(testApp: TestApp, text: string): void {
    typeText(testApp, text);
}

/** Tears down the workbench and removes the temp directory. Use in afterEach. */
export function disposeFindApp(ctx: FindContext): void {
    ctx.harness.dispose();
    ctx.workspace.dispose();
}
