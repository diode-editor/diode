import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createTestContainer } from "../../../../diode/modules/testProfile.ts";
import { LanguageServiceDIToken } from "../../../../editor/common/languages/iLanguageService.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { DiffEditorPane2 } from "../../../browser/parts/editor/diffEditorPane2.ts";
import type { WorkbenchComponent } from "../../../browser/workbenchComponent.ts";
import { WorkbenchComponentDIToken } from "../../../browser/workbenchComponent.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

import { openDiffPair } from "./openDiffPair.ts";

describe("openDiffPair", () => {
    let ws: ITempWorkspace;
    let workbench: WorkbenchComponent;
    let editors: IEditorService;
    let app: TestApp;
    let container: ReturnType<typeof createTestContainer>["container"];

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-diff-pair-",
            files: { "a.txt": "alpha\nbravo\n", "b.txt": "alpha\nBRAVO\n", "same.txt": "alpha\nbravo\n" },
        });
        const testContainer = createTestContainer();
        container = testContainer.container;
        workbench = container.get(WorkbenchComponentDIToken);
        editors = container.get(EditorServiceDIToken);
        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        app = TestApp.create(workbench.view, new Size(150, 16));
        testContainer.bindApp(app.app);
    });

    afterEach(() => {
        workbench.dispose();
        ws.dispose();
    });

    function fileSide(name: string) {
        const uri = Uri.file(ws.path(name));
        return { uri, label: name, identity: uri.toString() };
    }

    it("opens a tab for a file pair with side labels", async () => {
        const result = await openDiffPair(container, { original: fileSide("a.txt"), modified: fileSide("b.txt") });
        await settle(10);
        app.render();

        expect(result).toBe("opened");
        const screen = app.backend.screenToString();
        expect(screen).toContain("a.txt ↔ b.txt");
        expect(screen).toMatch(/2-\s+bravo/u);
        expect(screen).toMatch(/2\+\s+BRAVO/u);
    });

    it("sides of a new tab get editor.* settings like any editor", async () => {
        const applied = vi.spyOn(editors.editorConfiguration, "apply");

        await openDiffPair(container, { original: fileSide("a.txt"), modified: fileSide("b.txt") });

        const pane = editors.editorGroups.activeGroup.activePane;
        expect(pane instanceof DiffEditorPane2).toBe(true);
        for (const side of (pane as DiffEditorPane2).sidePanes()) expect(applied).toHaveBeenCalledWith(side);
    });

    it("the same pair is one tab, a repeated call refreshes the snapshot in place (US-32)", async () => {
        await openDiffPair(container, { original: fileSide("a.txt"), modified: fileSide("b.txt") });
        await settle(10);
        await openDiffPair(container, { original: fileSide("a.txt"), modified: fileSide("b.txt") });
        await settle(10);

        expect(editors.editorGroups.activeGroup.getPanes().filter((p) => p instanceof DiffEditorPane2)).toHaveLength(1);
    });

    it("another pair of the same file is a separate tab (US-33)", async () => {
        await openDiffPair(container, { original: fileSide("a.txt"), modified: fileSide("b.txt") });
        await settle(10);
        await openDiffPair(container, { original: fileSide("same.txt"), modified: fileSide("b.txt") });
        await settle(10);

        expect(editors.editorGroups.activeGroup.getPanes().filter((p) => p instanceof DiffEditorPane2)).toHaveLength(2);
    });

    it("a swapped pair is another tab: (left, right) ≠ (right, left)", async () => {
        await openDiffPair(container, { original: fileSide("a.txt"), modified: fileSide("b.txt") });
        await settle(10);
        await openDiffPair(container, { original: fileSide("b.txt"), modified: fileSide("a.txt") });
        await settle(10);

        expect(editors.editorGroups.activeGroup.getPanes().filter((p) => p instanceof DiffEditorPane2)).toHaveLength(2);
    });

    it("a text side without a uri (Clipboard) is compared with a file", async () => {
        const result = await openDiffPair(container, {
            original: { text: "alpha\nCLIP\n", label: "Clipboard", identity: "clipboard:" },
            modified: fileSide("a.txt"),
        });
        await settle(10);
        app.render();

        expect(result).toBe("opened");
        const screen = app.backend.screenToString();
        expect(screen).toContain("Clipboard ↔ a.txt");
        expect(screen).toMatch(/2-\s+CLIP/u);
        expect(screen).toMatch(/2\+\s+bravo/u);
    });

    it("identical sides give a tab with a message, not an empty diff (US-11)", async () => {
        const result = await openDiffPair(container, { original: fileSide("a.txt"), modified: fileSide("same.txt") });
        await settle(10);
        app.render();

        expect(result).toBe("opened");
        expect(app.backend.screenToString()).toContain("The files are identical");
        const pane = editors.editorGroups.activeGroup.getPanes().find((p) => p instanceof DiffEditorPane2);
        expect(pane).toBeDefined();
        editors.editorGroups.activeGroup.closeTab(
            editors.editorGroups.activeGroup.getPanes().indexOf(pane ?? editors.editorGroups.activeGroup.getPanes()[0]),
        );
        expect(editors.editorGroups.activeGroup.getPanes().filter((p) => p instanceof DiffEditorPane2)).toHaveLength(0);
    });

    it("an unreadable side with the error policy is a refusal without a tab", async () => {
        const result = await openDiffPair(container, {
            original: { uri: Uri.file(ws.path("gone.txt")), label: "gone.txt", identity: "gone" },
            modified: fileSide("a.txt"),
        });
        await settle(10);

        expect(result).toBe("unreadable");
        expect(editors.editorGroups.activeGroup.getPanes().filter((p) => p instanceof DiffEditorPane2)).toHaveLength(0);
    });

    it("an unreadable side with the empty policy diffs against empty (US-10)", async () => {
        const result = await openDiffPair(container, {
            original: { uri: Uri.file(ws.path("gone.txt")), label: "gone.txt", identity: "gone", onMissing: "empty" },
            modified: fileSide("a.txt"),
        });
        await settle(10);
        app.render();

        expect(result).toBe("opened");
        expect(app.backend.screenToString()).toMatch(/1\+\s+alpha/u);
    });

    it("a pair without any uri (text ↔ text) lives on a synthetic path", async () => {
        const result = await openDiffPair(container, {
            original: { text: "one\n", label: "L", identity: "l" },
            modified: { label: "R", identity: "r" },
        });
        await settle(10);
        app.render();

        // The right side has no text and no uri, so it is legitimately empty; the tab is `L ↔ R`.
        expect(result).toBe("opened");
        expect(app.backend.screenToString()).toContain("L ↔ R");
        expect(app.backend.screenToString()).toMatch(/1-\s+one/u);
    });

    it("file on the left and text on the right: the tab path comes from the left side", async () => {
        const result = await openDiffPair(container, {
            original: fileSide("a.txt"),
            modified: { text: "alpha\n", label: "snippet", identity: "snippet" },
        });
        await settle(10);

        expect(result).toBe("opened");
        const pane = editors.editorGroups.activeGroup.getPanes().find((p) => p instanceof DiffEditorPane2);
        expect(pane?.uri.path.endsWith("a.txt")).toBe(true);
    });

    it("a repeated call with a vanished snapshot side is unreadable, the tab stays", async () => {
        // The snapshot side is preferDisk (like "Compare with Saved").
        const spec = {
            original: {
                uri: Uri.file(ws.path("a.txt")),
                label: "a.txt (on disk)",
                identity: "saved:a",
                preferDisk: true,
            },
            modified: fileSide("a.txt"),
        };
        expect(await openDiffPair(container, spec)).toBe("opened");
        await settle(10);

        // The file is gone from disk: nothing to refresh the snapshot with.
        const { rmSync } = await import("node:fs");
        rmSync(ws.path("a.txt"));
        expect(await openDiffPair(container, spec)).toBe("unreadable");
        expect(editors.editorGroups.activeGroup.getPanes().filter((p) => p instanceof DiffEditorPane2)).toHaveLength(1);
    });

    it("a text side on the left and an unreadable one on the right: a refusal without a leak", async () => {
        const result = await openDiffPair(container, {
            original: { text: "one\n", label: "L", identity: "l" },
            modified: { uri: Uri.file(ws.path("gone.txt")), label: "gone", identity: "gone" },
        });

        expect(result).toBe("unreadable");
        expect(editors.editorGroups.activeGroup.getPanes().filter((p) => p instanceof DiffEditorPane2)).toHaveLength(0);
    });

    it("both sides are missing files with the empty policy: language from the path extension", async () => {
        // Own container: the language service is replaced BEFORE the first get (DI cache);
        // the files are neither in buffers nor on disk, so the language must come from the extension.
        const local = createTestContainer();
        const asked: string[] = [];
        local.container.bind(LanguageServiceDIToken, () => ({
            getLanguageIdForResource: (filePath: string) => {
                asked.push(filePath);
                return filePath.endsWith(".ts") ? "typescript" : undefined;
            },
            getLanguageDisplayName: () => undefined,
            getRegisteredLanguageIds: () => [],
            getExtensionForLanguage: () => undefined,
            requestLanguageFeatures: () => undefined,
            onDidRequestLanguageFeatures: () => ({ dispose: () => undefined }),
        }));
        const bench = local.container.get(WorkbenchComponentDIToken);
        bench.setWorkspaceFolder(ws.dir);
        bench.mount();
        const localApp = TestApp.create(bench.view, new Size(150, 16));
        local.bindApp(localApp.app);

        const result = await openDiffPair(local.container, {
            original: { uri: Uri.file(ws.path("no1.ts")), label: "no1.ts", identity: "n1", onMissing: "empty" },
            modified: { uri: Uri.file(ws.path("no2.ts")), label: "no2.ts", identity: "n2", onMissing: "empty" },
        });
        await settle(10);
        localApp.render();

        // Empty ↔ empty: the tab opens with the identical-files notice, the language is asked
        // by extension (there is no model).
        expect(result).toBe("opened");
        expect(asked.some((p) => p.endsWith("no2.ts"))).toBe(true);
        expect(localApp.backend.screenToString()).toContain("The files are identical");
        bench.dispose();
    });

    it("a repeated call refreshes the text side and tolerates an empty side", async () => {
        const spec = (clip: string) => ({
            original: { text: clip, label: "L", identity: "l" },
            modified: { label: "R", identity: "r" },
        });
        expect(await openDiffPair(container, spec("one\n"))).toBe("opened");
        await settle(10);

        // Repeat with new text: same tab, fresh text on the left; the right
        // side (no text, no uri) refreshes to empty without errors.
        expect(await openDiffPair(container, spec("two\n"))).toBe("opened");
        await settle(10);
        app.render();

        expect(editors.editorGroups.activeGroup.getPanes().filter((p) => p instanceof DiffEditorPane2)).toHaveLength(1);
        expect(app.backend.screenToString()).toMatch(/1-\s+two/u);
    });

    it("a side with a scheme without a provider is a refusal", async () => {
        const result = await openDiffPair(container, {
            original: { uri: Uri.from({ scheme: "weird", path: "/x" }), label: "x", identity: "weird:/x" },
            modified: fileSide("a.txt"),
        });

        expect(result).toBe("unreadable");
    });

    it("the highlighting language comes from the file extension when the buffer is not open", async () => {
        // Own container: the language service is replaced BEFORE the first get (DI cache).
        const { writeFileSync } = await import("node:fs");
        writeFileSync(ws.path("c.ts"), "const x = 1;\n");
        writeFileSync(ws.path("d.ts"), "const x = 2;\n");
        const local = createTestContainer();
        const asked: string[] = [];
        local.container.bind(LanguageServiceDIToken, () => ({
            getLanguageIdForResource: (filePath: string) => {
                asked.push(filePath);
                return filePath.endsWith(".ts") ? "typescript" : undefined;
            },
            getLanguageDisplayName: () => undefined,
            getRegisteredLanguageIds: () => [],
            getExtensionForLanguage: () => undefined,
            requestLanguageFeatures: () => undefined,
            onDidRequestLanguageFeatures: () => ({ dispose: () => undefined }),
        }));
        const bench = local.container.get(WorkbenchComponentDIToken);
        bench.setWorkspaceFolder(ws.dir);
        bench.mount();
        const localApp = TestApp.create(bench.view, new Size(150, 16));
        local.bindApp(localApp.app);

        const result = await openDiffPair(local.container, {
            original: fileSide("c.ts"),
            modified: fileSide("d.ts"),
        });
        await settle(10);

        expect(result).toBe("opened");
        expect(asked.some((p) => p.endsWith("d.ts"))).toBe(true);
        bench.dispose();
    });

    it("unsaved edits of an open buffer are visible in the diff", async () => {
        container.get(CommandRegistryDIToken).execute("workbench.openFile", ws.path("a.txt"));
        await settle(0);
        const editor = editors.getActiveEditor();
        editor?.goToPosition(1, 0);
        editor?.viewState.type("XX");

        await openDiffPair(container, { original: fileSide("b.txt"), modified: fileSide("a.txt") });
        await settle(10);
        app.render();

        expect(app.backend.screenToString()).toContain("XXbravo");
    });
});
