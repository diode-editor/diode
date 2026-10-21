import { Size } from "@tuidom/core/common/geometryPromitives";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { settle } from "../../../TestUtils/timing.ts";
import { Uri } from "../../base/common/uri.ts";
import { createTestContainer } from "../../diode/modules/testProfile.ts";
import { CommandRegistry, CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import type { IEditorService } from "../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";

import type { IEditorPane } from "./parts/editor/iEditorPane.ts";
import { WorkbenchComponent, WorkbenchComponentDIToken } from "./workbenchComponent.ts";

const PANE_TEXT = "PANE-CONTENT";

class TextOnlyPane implements IEditorPane {
    public readonly view = new TextLabelElement(PANE_TEXT);
    public readonly isModified = false;
    public readonly readOnly = false;

    public readonly label = "diff-stub";

    public constructor(public readonly uri: Uri) {}

    public onDidChangeState(): { dispose: () => void } {
        return { dispose: () => undefined };
    }

    public focusEditor(): void {
        // Nothing to focus — the pane does not accept input.
    }

    public getSelectedTexts(): string[] {
        return [];
    }

    public dispose(): void {
        // The view is not detached here: the group holds it as content, and setParent(null) would
        // leave a half-attached state (caught by validateTree). The group's content slot detaches it.
    }
}

describe("Workbench: a non-text pane in a tab", () => {
    let ws: ITempWorkspace;
    let workbench: WorkbenchComponent;
    let commands: CommandRegistry;
    let editors: IEditorService;
    let testApp: TestApp;

    beforeEach(async () => {
        ws = createTempWorkspace({ prefix: "diode-panes-", files: { "a.txt": "first line\n" } });

        const { container, bindApp } = createTestContainer();
        workbench = container.get(WorkbenchComponentDIToken);
        commands = container.get(CommandRegistryDIToken);
        editors = container.get(EditorServiceDIToken);

        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        testApp = TestApp.create(workbench.view, new Size(90, 14));
        bindApp(testApp.app);

        commands.execute("workbench.openFile", ws.path("a.txt"));
        await settle(0);
    });

    afterEach(() => {
        workbench.dispose();
        ws.dispose();
    });

    it("the pane content is on screen, the text editor's is not", () => {
        testApp.render();
        expect(testApp.backend.screenToString()).toContain("first line");

        editors.openPane(new TextOnlyPane(Uri.from({ scheme: "fake", path: "/changes" })));
        testApp.render();

        const screen = testApp.backend.screenToString();
        expect(screen).toContain(PANE_TEXT);
        expect(screen).not.toContain("first line");
    });

    it("the tab strip shows both tabs", () => {
        editors.openPane(new TextOnlyPane(Uri.from({ scheme: "fake", path: "/changes" })));
        testApp.render();

        const screen = testApp.backend.screenToString();
        expect(screen).toContain("a.txt");
        expect(screen).toContain("diff-stub");
    });

    it("returning to the text tab brings back its content", () => {
        editors.openPane(new TextOnlyPane(Uri.from({ scheme: "fake", path: "/changes" })));
        testApp.render();
        expect(testApp.backend.screenToString()).toContain(PANE_TEXT);

        editors.editorGroups.activeGroup.activateTab(0);
        testApp.render();

        const screen = testApp.backend.screenToString();
        expect(screen).toContain("first line");
        expect(screen).not.toContain(PANE_TEXT);
    });

    it("closing the pane tab removes it from the screen", () => {
        editors.openPane(new TextOnlyPane(Uri.from({ scheme: "fake", path: "/changes" })));
        testApp.render();

        editors.editorGroups.activeGroup.closeTab(editors.editorGroups.activeGroup.activeIndex);
        testApp.render();

        expect(testApp.backend.screenToString()).not.toContain(PANE_TEXT);
        expect(testApp.backend.screenToString()).toContain("first line");
    });
});
