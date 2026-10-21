import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { settle } from "../../../TestUtils/timing.ts";
import { Event } from "../../base/common/event.ts";
import { Uri } from "../../base/common/uri.ts";
import { createTestContainer } from "../../diode/modules/testProfile.ts";
import type { EditorElement } from "../../editor/browser/editorElement.ts";
import { CommandRegistry, CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { FileSystemProviderCapabilities, IFileServiceDIToken } from "../../platform/files/common/files.ts";
import { FileService } from "../../platform/files/common/fileService.ts";
import { ORIGINAL_RESOURCE_COMMAND } from "../contrib/scm/browser/commandOriginalResourceProvider.ts";
import type { IEditorService } from "../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";
import { LifecycleServiceDIToken } from "../services/lifecycle/browser/lifecycleService.ts";
import { ThemeServiceDIToken } from "../services/themes/common/themeTokens.ts";

import { WorkbenchComponent, WorkbenchComponentDIToken } from "./workbenchComponent.ts";

/**
 * Asserts on the bar painted for a buffer edit without saving: the extension used to
 * compute hunks from disk, so the bars stayed until Ctrl+S. A stub plays git.
 */

const BAR_DASHED = "┋"; // modification (VS Code dirty-diff draws it dashed)
const ORIGINAL_TEXT = "line one\nline two\nline three\n";
const DOCUMENT_LINES = 4;

describe("Workbench — живой гуттер quick diff", () => {
    let ws: ITempWorkspace;
    let workbench: WorkbenchComponent;
    let commands: CommandRegistry;
    let testApp: TestApp;
    let filePath: string;
    let modifiedColor: number;
    let editors: IEditorService;

    beforeEach(async () => {
        ws = createTempWorkspace({ prefix: "diode-quickdiff-", files: { "a.txt": ORIGINAL_TEXT } });
        filePath = ws.path("a.txt");

        const { container, bindApp } = createTestContainer();

        const registry = new FileService();
        registry.registerProvider("git", {
            capabilities: FileSystemProviderCapabilities.Readonly,
            readFile: () => Promise.resolve(new TextEncoder().encode(ORIGINAL_TEXT)),
            onDidChangeFile: Event.None,
        });
        container.bind(IFileServiceDIToken, () => registry);

        workbench = container.get(WorkbenchComponentDIToken);
        commands = container.get(CommandRegistryDIToken);
        commands.register(ORIGINAL_RESOURCE_COMMAND, (raw) =>
            Uri.from({ scheme: "git", path: String(raw), query: '{"ref":"HEAD"}' }).toString(),
        );

        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        testApp = TestApp.create(workbench.view, new Size(80, 12));
        bindApp(testApp.app);
        modifiedColor = container.get(ThemeServiceDIToken).theme.getRequiredColor("editorGutter.modifiedBackground");
        editors = container.get(EditorServiceDIToken);

        commands.execute("workbench.openFile", filePath);
        // As in the app: change bars are an `afterRestored`-phase contribution; it is
        // created after the startup files open and must pick up the already active
        // editor.
        container.get(LifecycleServiceDIToken).setPhase("eventually");
        await settle(0);
    });

    afterEach(() => {
        workbench.dispose();
        ws.dispose();
    });

    /** The editor is offset by the sidebar and the tab strip, so take the absolute position. */
    function barColumn(): number {
        const editor = testApp.querySelector("EditorElement") as EditorElement;
        return editor.globalPosition.x + editor.foldControlColumn - 1;
    }

    /** Bars by DOCUMENT lines (0-based), not screen lines. */
    function barsOnScreen(): { line: number; char: string }[] {
        const editor = testApp.querySelector("EditorElement") as EditorElement;
        const x = barColumn();
        const top = editor.globalPosition.y;
        const found: { line: number; char: string }[] = [];
        for (let line = 0; line < DOCUMENT_LINES; line++) {
            const char = testApp.backend.getTextAt(new Point(x, top + line), 1);
            if (char !== " " && char !== "") found.push({ line, char });
        }
        return found;
    }

    it("чистый буфер — баров в гуттере нет", async () => {
        await settle(300);
        testApp.render();

        expect(barsOnScreen()).toEqual([]);
    });

    it("правка БЕЗ сохранения красит изменённую строку — регрессия на залипший гуттер", async () => {
        await settle(300);
        testApp.render();
        expect(barsOnScreen()).toEqual([]);

        const editor = editors.getActiveEditor();
        expect(editor).not.toBeNull();
        editor!.goToPosition(1, 0);
        editor!.viewState.type("X");

        // Leave the file on disk alone: the old path (git diff against disk) would stay silent here.
        expect(editor!.isModified).toBe(true);

        await settle(300);
        testApp.render();

        const bars = barsOnScreen();
        expect(bars).toEqual([{ line: 1, char: BAR_DASHED }]);
        const top = (testApp.querySelector("EditorElement") as EditorElement).globalPosition.y;
        expect(testApp.backend.getFgAt(new Point(barColumn(), top + 1))).toBe(modifiedColor);
    });

    it("возврат текста к исходному убирает бар", async () => {
        const editor = editors.getActiveEditor();
        editor!.goToPosition(1, 0);
        editor!.viewState.type("X");
        await settle(300);
        testApp.render();
        expect(barsOnScreen()).toHaveLength(1);

        editor!.viewState.deleteLeft();
        await settle(300);
        testApp.render();

        expect(editor!.getText()).toBe(ORIGINAL_TEXT);
        expect(barsOnScreen()).toEqual([]);
    });
});
