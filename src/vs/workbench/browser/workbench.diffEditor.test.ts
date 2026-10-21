import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { settle } from "../../../TestUtils/timing.ts";
import { Event } from "../../base/common/event.ts";
import { Uri } from "../../base/common/uri.ts";
import { createTestContainer } from "../../diode/modules/testProfile.ts";
import { ClipboardDIToken } from "../../platform/clipboard/common/iClipboard.ts";
import { CommandRegistry, CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { FileSystemProviderCapabilities, IFileServiceDIToken } from "../../platform/files/common/files.ts";
import { FileService } from "../../platform/files/common/fileService.ts";
import { ORIGINAL_RESOURCE_COMMAND } from "../contrib/scm/browser/commandOriginalResourceProvider.ts";
import { COMPARE_NOTICE_MS, openDiffWithHead } from "../contrib/scm/browser/compareWithHeadAction.ts";
import type { IEditorService } from "../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";
import { StatusBarServiceDIToken } from "../services/statusbar/common/statusBarService.ts";

import { WorkbenchComponent, WorkbenchComponentDIToken } from "./workbenchComponent.ts";

/**
 * A stub plays the SCM role and serves the "HEAD version" like the git extension does;
 * the whole core path from command to frame is real.
 */

const AT_HEAD = "alpha\nbravo\ncharlie\ndelta\n";
const COMPARE = "diode.scm.compareWithHead";

describe("Workbench — diff tab", () => {
    let ws: ITempWorkspace;
    let workbench: WorkbenchComponent;
    let commands: CommandRegistry;
    let editors: IEditorService;
    let testApp: TestApp;
    let container: ReturnType<typeof createTestContainer>["container"];

    beforeEach(async () => {
        ws = createTempWorkspace({ prefix: "diode-diff-", files: { "a.txt": AT_HEAD } });

        const testContainer = createTestContainer();
        const bindApp = testContainer.bindApp;
        container = testContainer.container;
        const registry = new FileService();
        registry.registerProvider("git", {
            capabilities: FileSystemProviderCapabilities.Readonly,
            readFile: () => Promise.resolve(new TextEncoder().encode(AT_HEAD)),
            onDidChangeFile: Event.None,
        });
        container.bind(IFileServiceDIToken, () => registry);

        workbench = container.get(WorkbenchComponentDIToken);
        commands = container.get(CommandRegistryDIToken);
        editors = container.get(EditorServiceDIToken);
        commands.register(ORIGINAL_RESOURCE_COMMAND, (raw) =>
            Uri.from({ scheme: "git", path: String(raw), query: '{"ref":"HEAD"}' }).toString(),
        );

        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        testApp = TestApp.create(workbench.view, new Size(150, 16));
        bindApp(testApp.app);

        commands.execute("workbench.openFile", ws.path("a.txt"));
        await settle(0);
    });

    afterEach(() => {
        workbench.dispose();
        ws.dispose();
    });

    /** Edits the buffer without saving: the diff must show exactly the unsaved state. */
    function editBuffer(): void {
        const editor = editors.getActiveEditor();
        editor?.goToPosition(1, 0);
        editor?.viewState.type("XX");
    }

    it("the command opens a diff tab and shows - and + lines", async () => {
        editBuffer();

        commands.execute(COMPARE);
        await settle(10);
        testApp.render();

        const screen = testApp.backend.screenToString();
        expect(screen).toContain("a.txt ↔ HEAD");
        expect(screen).toMatch(/2-\s+bravo/u);
        expect(screen).toMatch(/2\+\s+XXbravo/u);
    });

    it("the diff tab closes without a save dialog", async () => {
        editBuffer();
        commands.execute(COMPARE);
        await settle(10);

        const pane = editors.getActivePane();
        // The modified side is the live buffer with edits, yet no dialog is needed: the edits
        // live in the shared model and show in the file's tab.
        expect(pane?.isModified).toBe(true);
        expect(pane === null ? true : editors.needsCloseConfirm(pane)).toBe(false);

        editors.editorGroups.activeGroup.closeTab(editors.editorGroups.activeGroup.activeIndex);
        testApp.render();

        expect(testApp.backend.screenToString()).not.toContain("↔ HEAD");
    });

    it("a repeated call switches to the existing tab instead of opening new ones", async () => {
        editBuffer();
        commands.execute(COMPARE);
        await settle(10);
        const countAfterFirst = editors.editorGroups.activeGroup.editorCount;

        editors.editorGroups.activeGroup.activateTab(0);
        commands.execute(COMPARE);
        await settle(10);

        expect(editors.editorGroups.activeGroup.editorCount).toBe(countAfterFirst);
    });

    it("a repeated call after a new edit shows a fresh snapshot, not a stale one", async () => {
        editBuffer();
        commands.execute(COMPARE);
        await settle(10);
        testApp.render();
        expect(testApp.backend.screenToString()).toMatch(/2\+\s+XXbravo/u);

        editors.editorGroups.activeGroup.activateTab(0);
        const editor = editors.getActiveEditor();
        editor?.goToPosition(1, 0);
        editor?.viewState.type("YY");

        commands.execute(COMPARE);
        await settle(10);
        testApp.render();

        const screen = testApp.backend.screenToString();
        expect(screen).toMatch(/2\+\s+YYXXbravo/u);
        expect(editors.editorGroups.activeGroup.getPanes().filter((p) => p.uri.scheme === "diode-diff")).toHaveLength(
            1,
        );
    });

    it("going back to the file restores the regular editor", async () => {
        editBuffer();
        commands.execute(COMPARE);
        await settle(10);
        testApp.render();
        expect(testApp.backend.screenToString()).toContain("↔ HEAD");

        editors.editorGroups.activeGroup.activateTab(0);
        testApp.render();

        const screen = testApp.backend.screenToString();
        expect(screen).toContain("XXbravo");
        expect(screen).not.toMatch(/2-\s+bravo/u);
    });

    it("without a git version the tab does not open and the status bar shows a message", async () => {
        // Remove the SCM command: this is how an untracked file or a missing extension looks.
        const { container, bindApp } = createTestContainer();
        const bare = container.get(WorkbenchComponentDIToken);
        const bareCommands = container.get(CommandRegistryDIToken);
        const bareEditors = container.get(EditorServiceDIToken);
        bare.setWorkspaceFolder(ws.dir);
        bare.mount();
        const app = TestApp.create(bare.view, new Size(150, 16));
        bindApp(app.app);
        bareCommands.execute("workbench.openFile", ws.path("a.txt"));
        await settle(0);

        bareCommands.execute(COMPARE);
        await settle(10);
        app.render();

        expect(bareEditors.editorGroups.activeGroup.editorCount).toBe(1);
        expect(app.backend.screenToString()).toContain("No changes to compare");
        bare.dispose();
    });

    async function openDiff(): Promise<void> {
        editBuffer();
        commands.execute(COMPARE);
        await settle(10);
        editors.getActivePane()?.focusEditor();
        testApp.render();
    }

    it("the active pane exposes its side as a real text editor", async () => {
        await openDiff();

        expect(editors.getActiveViewState()).not.toBeNull();
        expect(editors.getActiveViewState()?.readOnly).toBe(false);
        const side = editors.getActiveEditor();
        expect(side).not.toBeNull();
        expect(side?.uri.toString()).toBe(Uri.file(ws.path("a.txt")).toString());
    });

    it("focus in the diff sets textViewFocus and textInputFocus of the live side", async () => {
        await openDiff();
        const contextKeys = container.get(ContextKeyServiceDIToken);

        expect(contextKeys.evaluate("textViewFocus")).toBe(true);
        expect(contextKeys.evaluate("textInputFocus")).toBe(true);
        expect(contextKeys.evaluate("editorReadonly")).toBe(false);
    });

    it("cursor commands move the cursor through the diff", async () => {
        await openDiff();

        commands.execute("cursorDown");
        commands.execute("cursorDown");
        commands.execute("cursorEnd");

        const active = editors.getActiveViewState()?.selections[0].active;
        expect(active?.line).toBe(2);
        expect(active?.character).toBeGreaterThan(0);
    });

    it("Ctrl+A and Copy put the diff text on the clipboard without line numbers or markers", async () => {
        await openDiff();

        commands.execute("editor.action.selectAll");
        await commands.execute("editor.action.clipboardCopyAction");

        const copied = await container.get(ClipboardDIToken).readText();
        expect(copied).toContain("XXbravo");
        expect(copied).not.toMatch(/^\s*\d+\s+\d+\s+[-+]/mu);
        // Placeholders of collapsed regions are not file text either.
        expect(copied).not.toContain("unchanged line");
    });

    it("edit commands do nothing on the diff", async () => {
        await openDiff();
        const before = editors.getActiveViewState()?.document.getText();

        commands.execute("deleteLeft");
        await commands.execute("editor.action.clipboardPasteAction");

        expect(editors.getActiveViewState()?.document.getText()).toBe(before);
    });
});

describe("Workbench — diff tab, failures", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-diff-fail-", files: { "a.txt": AT_HEAD } });
    });

    afterEach(() => {
        vi.useRealTimers();
        ws.dispose();
    });

    async function withFailingProvider() {
        const { container, bindApp } = createTestContainer();
        const registry = new FileService();
        registry.registerProvider("git", {
            capabilities: FileSystemProviderCapabilities.Readonly,
            readFile: () => Promise.reject(new Error("git unavailable")),
            onDidChangeFile: Event.None,
        });
        container.bind(IFileServiceDIToken, () => registry);

        const workbench = container.get(WorkbenchComponentDIToken);
        const commands = container.get(CommandRegistryDIToken);
        const editors = container.get(EditorServiceDIToken);
        commands.register(ORIGINAL_RESOURCE_COMMAND, (raw) =>
            Uri.from({ scheme: "git", path: String(raw), query: '{"ref":"HEAD"}' }).toString(),
        );
        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        const app = TestApp.create(workbench.view, new Size(150, 16));
        bindApp(app.app);
        commands.execute("workbench.openFile", ws.path("a.txt"));
        await settle(0);
        return { workbench, commands, editors, app, statusBar: container.get(StatusBarServiceDIToken) };
    }

    it("an error reading the original does not open a tab or crash the command", async () => {
        const { workbench, commands, editors, app } = await withFailingProvider();

        commands.execute(COMPARE);
        await settle(10);
        app.render();

        expect(editors.editorGroups.activeGroup.editorCount).toBe(1);
        expect(app.backend.screenToString()).toContain("No changes to compare");
        workbench.dispose();
    });

    it("the cannot-compare message disappears over time", async () => {
        const { workbench, commands, app, statusBar } = await withFailingProvider();

        vi.useFakeTimers();
        commands.execute(COMPARE);
        await vi.advanceTimersByTimeAsync(10);
        // The entry is addressable by its id, which is used to hide and rewrite it.
        expect(statusBar.entries().map((e) => e.id)).toContain("diff.compare.notice");

        await vi.advanceTimersByTimeAsync(COMPARE_NOTICE_MS);
        vi.useRealTimers();
        app.render();

        expect(app.backend.screenToString()).not.toContain("No changes to compare");
        workbench.dispose();
    });
});

describe("Workbench — diff without an open file (openDiffWithHead)", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-diff-core-", files: { "a.txt": "alpha\nBRAVO\ncharlie\ndelta\n" } });
    });

    afterEach(() => {
        ws.dispose();
    });

    /** The built-in registry already knows `file:` (markersModule); `git:` is added as an extension adapter would. */
    function mountWorkbench() {
        const { container, bindApp } = createTestContainer();
        container.get(IFileServiceDIToken).registerProvider("git", {
            capabilities: FileSystemProviderCapabilities.Readonly,
            readFile: () => Promise.resolve(new TextEncoder().encode(AT_HEAD)),
            onDidChangeFile: Event.None,
        });
        const workbench = container.get(WorkbenchComponentDIToken);
        const commands = container.get(CommandRegistryDIToken);
        const editors = container.get(EditorServiceDIToken);
        commands.register(ORIGINAL_RESOURCE_COMMAND, (raw) =>
            Uri.from({ scheme: "git", path: String(raw), query: '{"ref":"HEAD"}' }).toString(),
        );
        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        const app = TestApp.create(workbench.view, new Size(150, 16));
        bindApp(app.app);
        return { container, workbench, editors, app };
    }

    it("modified is read from disk: one diff tab opens, no file tab", async () => {
        const { container, workbench, editors, app } = mountWorkbench();

        const result = await openDiffWithHead(container, Uri.file(ws.path("a.txt")));
        await settle(10);
        app.render();

        expect(result).toBe("opened");
        const screen = app.backend.screenToString();
        expect(screen).toContain("a.txt ↔ HEAD");
        expect(screen).toMatch(/2-\s+bravo/u);
        expect(screen).toMatch(/2\+\s+BRAVO/u);
        expect(editors.editorGroups.activeGroup.getPanes().map((p) => p.uri.scheme)).toEqual(["diode-diff"]);
        workbench.dispose();
    });

    it("a file unreadable from disk (deleted) yields a «HEAD ↔ empty» diff", async () => {
        const { container, workbench, app } = mountWorkbench();

        // The extension is unknown to the language service, which also covers the languageId
        // fallback to plaintext.
        const result = await openDiffWithHead(container, Uri.file(ws.path("gone.weird")));
        await settle(10);
        app.render();

        expect(result).toBe("opened");
        const screen = app.backend.screenToString();
        expect(screen).toContain("gone.weird ↔ HEAD");
        expect(screen).toMatch(/1-\s+alpha/u);
        expect(screen).toMatch(/4-\s+delta/u);
        expect(screen).not.toMatch(/\d\+ +\S/u);
        workbench.dispose();
    });

    it("«no original» is returned to the caller without side effects", async () => {
        // ORIGINAL_RESOURCE_COMMAND is not registered: there is no SCM extension.
        const { container, bindApp } = createTestContainer();
        const workbench = container.get(WorkbenchComponentDIToken);
        const editors = container.get(EditorServiceDIToken);
        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        const app = TestApp.create(workbench.view, new Size(150, 16));
        bindApp(app.app);

        const result = await openDiffWithHead(container, Uri.file(ws.path("a.txt")));
        app.render();

        expect(result).toBe("no-original");
        expect(editors.editorGroups.activeGroup.editorCount).toBe(0);
        expect(app.backend.screenToString()).not.toContain("No changes to compare");
        workbench.dispose();
    });
});

describe("Workbench — diff on a wide terminal (side-by-side)", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-diff-wide-", files: { "a.txt": AT_HEAD } });
    });

    afterEach(() => {
        ws.dispose();
    });

    async function mountWide() {
        const { container, bindApp } = createTestContainer();
        const registry = new FileService();
        registry.registerProvider("git", {
            capabilities: FileSystemProviderCapabilities.Readonly,
            readFile: () => Promise.resolve(new TextEncoder().encode(AT_HEAD)),
            onDidChangeFile: Event.None,
        });
        container.bind(IFileServiceDIToken, () => registry);
        const workbench = container.get(WorkbenchComponentDIToken);
        const commands = container.get(CommandRegistryDIToken);
        const editors = container.get(EditorServiceDIToken);
        commands.register(ORIGINAL_RESOURCE_COMMAND, (raw) =>
            Uri.from({ scheme: "git", path: String(raw), query: '{"ref":"HEAD"}' }).toString(),
        );
        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        const app = TestApp.create(workbench.view, new Size(150, 16));
        bindApp(app.app);
        commands.execute("workbench.openFile", ws.path("a.txt"));
        await settle(0);
        return { workbench, commands, editors, app, statusBar: container.get(StatusBarServiceDIToken) };
    }

    it("the command opens two columns with side labels and an aligned edit", async () => {
        const { workbench, commands, editors, app } = await mountWide();
        const editor = editors.getActiveEditor();
        editor?.goToPosition(1, 0);
        editor?.viewState.type("XX");

        commands.execute(COMPARE);
        await settle(10);
        app.render();

        const lines = app.backend
            .screenToString()
            .split("\n")
            .map((l) => l.replace(/\s+$/, ""));
        // The tab row ("a.txt ↔ HEAD ×") is excluded by "↔".
        const header = lines.find((l) => l.includes("HEAD") && l.includes("│") && !l.includes("↔"));
        expect(header).toBeDefined();
        expect(header).toContain("a.txt");
        expect(header?.indexOf("HEAD")).toBeLessThan(header?.indexOf("a.txt") ?? -1);
        const pair = lines.find((l) => /2-\s+bravo/u.test(l));
        expect(pair).toBeDefined();
        expect(pair).toMatch(/2\+\s+XXbravo/u);
        expect(pair).toContain("│");
        workbench.dispose();
    });
});

describe("Workbench — diff tab, edge cases", () => {
    it("without an active editor the command does nothing", async () => {
        const ws = createTempWorkspace({ prefix: "diode-diff-empty-", files: {} });
        const { container, bindApp } = createTestContainer();
        const workbench = container.get(WorkbenchComponentDIToken);
        const commands = container.get(CommandRegistryDIToken);
        const editors = container.get(EditorServiceDIToken);
        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        bindApp(TestApp.create(workbench.view, new Size(80, 10)).app);

        expect(editors.editorGroups.activeGroup.editorCount).toBe(0);
        expect(() => {
            commands.execute(COMPARE);
        }).not.toThrow();
        await settle(10);

        expect(editors.editorGroups.activeGroup.editorCount).toBe(0);
        workbench.dispose();
        ws.dispose();
    });

    it("SCM returns a resource but there is no scheme provider — the tab does not open", async () => {
        const ws = createTempWorkspace({ prefix: "diode-diff-noprov-", files: { "a.txt": AT_HEAD } });
        const { container, bindApp } = createTestContainer();
        container.bind(IFileServiceDIToken, () => new FileService());
        const workbench = container.get(WorkbenchComponentDIToken);
        const commands = container.get(CommandRegistryDIToken);
        const editors = container.get(EditorServiceDIToken);
        commands.register(ORIGINAL_RESOURCE_COMMAND, (raw) =>
            Uri.from({ scheme: "git", path: String(raw) }).toString(),
        );
        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        const testApp = TestApp.create(workbench.view, new Size(80, 10));
        bindApp(testApp.app);
        commands.execute("workbench.openFile", ws.path("a.txt"));
        await settle(0);

        commands.execute(COMPARE);
        await settle(10);

        expect(editors.editorGroups.activeGroup.editorCount).toBe(1);
        // To the user this is the same "nothing to compare with", not a read error.
        testApp.render();
        expect(testApp.backend.screenToString()).toContain("No changes to compare");
        workbench.dispose();
        ws.dispose();
    });

    it("SCM reports «no original» — the tab does not open", async () => {
        const ws = createTempWorkspace({ prefix: "diode-diff-none-", files: { "a.txt": AT_HEAD } });
        const { container, bindApp } = createTestContainer();
        const registry = new FileService();
        registry.registerProvider("git", {
            capabilities: FileSystemProviderCapabilities.Readonly,
            readFile: () => Promise.resolve(new TextEncoder().encode(AT_HEAD)),
            onDidChangeFile: Event.None,
        });
        container.bind(IFileServiceDIToken, () => registry);
        const workbench = container.get(WorkbenchComponentDIToken);
        const commands = container.get(CommandRegistryDIToken);
        const editors = container.get(EditorServiceDIToken);
        // This is how the git extension answers for an untracked file.
        commands.register(ORIGINAL_RESOURCE_COMMAND, () => null);
        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        bindApp(TestApp.create(workbench.view, new Size(80, 10)).app);
        commands.execute("workbench.openFile", ws.path("a.txt"));
        await settle(0);

        commands.execute(COMPARE);
        await settle(10);

        expect(editors.editorGroups.activeGroup.editorCount).toBe(1);
        workbench.dispose();
        ws.dispose();
    });
});
