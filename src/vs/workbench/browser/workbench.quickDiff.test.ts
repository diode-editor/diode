import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { flushMicrotasks, settle } from "../../../TestUtils/timing.ts";
import { Event } from "../../base/common/event.ts";
import { Uri } from "../../base/common/uri.ts";
import { createTestContainer } from "../../diode/modules/testProfile.ts";
import type { EditorElement } from "../../editor/browser/editorElement.ts";
import { CommandRegistry, CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { FileSystemProviderCapabilities, IFileServiceDIToken } from "../../platform/files/common/files.ts";
import { FileService } from "../../platform/files/common/fileService.ts";
import { EditorDecorationsServiceAdapter } from "../api/browser/editorDecorationsServiceAdapter.ts";
import { ThemeColorResolverAdapter } from "../api/browser/themeColorResolverAdapter.ts";
import { createInProcessChannelPair } from "../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../api/common/rpcEndpoint.ts";
import { ORIGINAL_RESOURCE_COMMAND } from "../contrib/scm/browser/commandOriginalResourceProvider.ts";
import type { IEditorService } from "../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";
import { DecorationsCustomer } from "../services/extensions/node/customers/decorationsCustomer.ts";
import { LifecycleServiceDIToken } from "../services/lifecycle/browser/lifecycleService.ts";
import type { ThemeService } from "../services/themes/common/themeService.ts";
import { ThemeServiceDIToken } from "../services/themes/common/themeTokens.ts";

import { WorkbenchComponent, WorkbenchComponentDIToken } from "./workbenchComponent.ts";

/**
 * Asserts on the bar painted for a buffer edit without saving: the extension used to
 * compute hunks from disk, so the bars stayed until Ctrl+S. A stub plays git.
 */

const BAR_DASHED = "┋"; // modification (VS Code dirty-diff draws it dashed)
const BAR_SOLID = "┃"; // an extension type that is not editorGutter.modifiedBackground
const ORIGINAL_TEXT = "line one\nline two\nline three\n";
const DOCUMENT_LINES = 4;

describe("Workbench: live quick diff gutter", () => {
    let ws: ITempWorkspace;
    let workbench: WorkbenchComponent;
    let commands: CommandRegistry;
    let testApp: TestApp;
    let filePath: string;
    let modifiedColor: number;
    let editors: IEditorService;
    let themeService: ThemeService;

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
        themeService = container.get(ThemeServiceDIToken);
        modifiedColor = themeService.theme.getRequiredColor("editorGutter.modifiedBackground");
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

    it("a clean buffer has no bars in the gutter", async () => {
        await settle(300);
        testApp.render();

        expect(barsOnScreen()).toEqual([]);
    });

    it("an edit WITHOUT saving colors the changed line (regression for a stale gutter)", async () => {
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

    /**
     * Regression: both producers once wrote one gutter slot, so an extension clearing its own type on every
     * keystroke (Claude Code's hunk bars) erased the git bars until the next quick diff recompute — the bars
     * flickered while typing. The real extension path (customer → adapter) runs next to the real quick diff.
     */
    it("extension decoration bars and git bars coexist: clearing the extension type keeps the git bar", async () => {
        const decorations = new DecorationsCustomer(
            new EditorDecorationsServiceAdapter(editors),
            { setFileDecorations: () => undefined },
            new ThemeColorResolverAdapter(themeService),
        );
        const [hostSide, extensionSide] = createInProcessChannelPair();
        const extension = new RpcEndpoint(extensionSide);
        const attached = decorations.attach({ rpc: new RpcEndpoint(hostSide), logger: undefined });
        const uri = Uri.file(filePath).toString();
        const extensionBars = (line: number | null): void => {
            const ranges = line === null ? [] : [{ start: { line, character: 0 }, end: { line, character: 0 } }];
            extension.notify("editor.setDecorations", { key: 1, uri, ranges });
        };
        extension.notify("window.createTextEditorDecorationType", {
            key: 1,
            options: { overviewRulerColor: { $themeColor: "editorGutter.addedBackground" } },
        });

        const editor = editors.getActiveEditor();
        editor!.goToPosition(1, 0);
        editor!.viewState.type("X");
        await settle(300);
        extensionBars(3);
        await flushMicrotasks();
        testApp.render();
        expect(barsOnScreen()).toEqual([
            { line: 1, char: BAR_DASHED },
            { line: 3, char: BAR_SOLID },
        ]);

        // As the extension does on every document change; no quick diff recompute in between.
        extensionBars(null);
        await flushMicrotasks();
        testApp.render();
        expect(barsOnScreen()).toEqual([{ line: 1, char: BAR_DASHED }]);
        const top = (testApp.querySelector("EditorElement") as EditorElement).globalPosition.y;
        expect(testApp.backend.getFgAt(new Point(barColumn(), top + 1))).toBe(modifiedColor);

        attached.dispose();
        decorations.dispose();
    });

    it("reverting the text to the original removes the bar", async () => {
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
