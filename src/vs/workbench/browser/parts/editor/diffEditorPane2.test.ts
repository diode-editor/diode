import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { typeText } from "../../../../../TestUtils/domQueries.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Event } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createTestContainer } from "../../../../diode/modules/testProfile.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { FileSystemProviderCapabilities, IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import { FileService } from "../../../../platform/files/common/fileService.ts";
import { StateServiceDIToken } from "../../../../platform/state/common/iStateService.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { diffPaneRecipe, openDiffPair, refreshDiffSnapshots } from "../../../contrib/diff/browser/openDiffPair.ts";
import { ORIGINAL_RESOURCE_COMMAND } from "../../../contrib/scm/browser/commandOriginalResourceProvider.ts";
import { DialogServiceDIToken } from "../../../services/dialogs/browser/dialogService.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { TextFileModel } from "../../../services/textfile/common/textFileModel.ts";
import type { WorkbenchComponent } from "../../workbenchComponent.ts";
import { WorkbenchComponentDIToken } from "../../workbenchComponent.ts";

import type { DiffV2SideSource } from "./diffEditorPane2.ts";
import { DiffEditorPane2 } from "./diffEditorPane2.ts";
import type { TextEditorPane } from "./textEditorPane.ts";

const AT_HEAD = [
    ...Array.from({ length: 14 }, (_, i) => `const value${String(i)} = ${String(i)};`),
    "old line",
    "tail",
].join("\n");

describe("DiffEditorPane2 — unit without the workbench", () => {
    function makePane(
        original: DiffV2SideSource | string,
        modified: DiffV2SideSource | string,
        options: { debounceMs?: number } = {},
    ): DiffEditorPane2 {
        return new DiffEditorPane2(
            NULL_LANGUAGE_SERVICE,
            new UndoRedoService(),
            diskFileService(),
            new TokenizationRegistry(),
            NULL_TOKEN_STYLE_RESOLVER,
            {
                uri: Uri.from({ scheme: "diode-diff", path: "/pair", query: "left=a&right=b" }),
                label: "a ↔ b",
                originalLabel: "a",
                modifiedLabel: "b",
                original: typeof original === "string" ? { kind: "snapshot", text: original } : original,
                modified: typeof modified === "string" ? { kind: "snapshot", text: modified } : modified,
                languageId: "plaintext",
                ...(options.debounceMs !== undefined ? { debounceMs: options.debounceMs } : {}),
            },
        );
    }

    function ownedModel(text: string): TextFileModel {
        const model = new TextFileModel(NULL_LANGUAGE_SERVICE, new UndoRedoService(), diskFileService());
        model.setUntitled(1);
        // Before the pane is created the model has no view — seed content straight into the document.
        if (text !== "") model.document.setText(text);
        return model;
    }

    function sides(pane: DiffEditorPane2): { original: TextEditorPane; modified: TextEditorPane } {
        const [original, modified] = pane.sidePanes();
        return { original, modified };
    }

    it("input without side uris (text sides) — originalUri/modifiedUri null, snapshot locked", () => {
        const pane = makePane("one\n", "two\n");

        expect(pane.originalUri).toBeNull();
        expect(pane.modifiedUri).toBeNull();
        expect(pane.readOnly).toBe(true);
        expect(pane.isModified).toBe(false);
        expect(pane.snapshotSides()).toEqual(["original", "modified"]);
        pane.dispose();
    });

    it("two collapsed hunks: banners do not mix between regions", () => {
        const base = Array.from({ length: 30 }, (_, i) => `l${String(i)}`);
        const original = [...base.slice(0, 10), "x", ...base.slice(10, 20), "y", ...base.slice(20)].join("\n");
        const modified = [...base.slice(0, 10), "X", ...base.slice(10, 20), "Y", ...base.slice(20)].join("\n");
        const pane = makePane(original, modified);

        const folded = pane.activeTextPane.viewState.foldedRegions.filter((r) => r.isCollapsed);
        expect(folded.length).toBeGreaterThanOrEqual(2);
        pane.activeTextPane.viewState.toggleFold(folded[0].startLine);
        const still = pane.activeTextPane.viewState.foldedRegions.filter((r) => r.isCollapsed);
        expect(still.length).toBe(folded.length - 1);
        pane.dispose();
    });

    it("wordWrap is forced off on the sides: sides align by view lines", () => {
        const pane = makePane("aaaa bbbb cccc", "aaaa bbbb cccc");
        const { original, modified } = sides(pane);
        expect(original.wordWrapForcedOff).toBe(true);
        expect(modified.wordWrapForcedOff).toBe(true);

        // Applying the setting / Alt+Z goes through setWordWrap — the side forces it off.
        modified.setWordWrap("on", 80);
        expect(modified.viewState.wordWrap).toBe("off");
        pane.dispose();
    });

    it("the owned side is editable, the diff recomputes after debounce, alignment holds", async () => {
        const base = Array.from({ length: 20 }, (_, i) => `line${String(i)}`).join("\n");
        const model = ownedModel(base);
        const pane = makePane(base, { kind: "owned", model }, { debounceMs: 0 });
        const { original, modified } = sides(pane);
        expect(pane.readOnly).toBe(false);
        expect(modified.readOnly).toBe(false);

        modified.goToPosition(0, 5);
        modified.viewState.type("X");
        expect(pane.isModified).toBe(true);
        await settle(5);

        expect(original.viewState.getViewLineCount()).toBe(modified.viewState.getViewLineCount());
        expect(modified.viewState.foldedRegions.some((r) => r.isCollapsed)).toBe(true);
        pane.dispose();
    });

    it("live recompute does not reset the cursor and keeps the hunk expanded", async () => {
        const base = Array.from({ length: 40 }, (_, i) => `line${String(i)}`).join("\n");
        const model = ownedModel(`${base}\nnew tail`);
        const pane = makePane(base, { kind: "owned", model }, { debounceMs: 0 });
        const { modified } = sides(pane);

        const region = modified.viewState.foldedRegions.find((r) => r.isCollapsed);
        expect(region).toBeDefined();
        modified.viewState.toggleFold(region?.startLine ?? 0);
        modified.goToPosition(40, 0);
        modified.viewState.type("Z");
        await settle(5);

        expect(modified.viewState.foldedRegions.some((r) => r.isCollapsed)).toBe(false);
        expect(modified.primaryCursorLine).toBe(40);
        pane.dispose();
    });

    it("a hunk covering the cursor expands — the typist does not end up on a hidden line", async () => {
        const base = Array.from({ length: 30 }, (_, i) => `line${String(i)}`).join("\n");
        const model = ownedModel(`${base}\nextra`);
        const pane = makePane(base, { kind: "owned", model }, { debounceMs: 0 });
        const { modified } = sides(pane);
        const region = modified.viewState.foldedRegions.find((r) => r.isCollapsed);
        expect(region).toBeDefined();

        modified.viewState.selections = [{ anchor: { line: 10, character: 0 }, active: { line: 10, character: 0 } }];
        modified.viewState.type("Q");
        await settle(5);

        expect(modified.viewState.logicalToVisualLine(modified.primaryCursorLine)).toBeGreaterThanOrEqual(0);
        pane.dispose();
    });

    it("scroll is anchored to the document line on recompute", async () => {
        const base = Array.from({ length: 60 }, (_, i) => `line${String(i)}`).join("\n");
        const model = ownedModel(base.replace("line30", "changed30"));
        const pane = makePane(base, { kind: "owned", model }, { debounceMs: 0 });
        const { modified, original } = sides(pane);

        for (const region of modified.viewState.foldedRegions) {
            if (region.isCollapsed) modified.viewState.toggleFold(region.startLine);
        }
        await settle(5);
        // Revealing the cursor moves the viewport, but the RECOMPUTE itself must not move it
        // further; original gets a filler zone, and the viewports stay mirrored.
        modified.goToPosition(59, 0);
        modified.viewState.type("Z");
        const anchorDoc = modified.viewState.docLineForViewLine(modified.viewState.scrollTop);
        await settle(5);

        expect(modified.viewState.docLineForViewLine(modified.viewState.scrollTop)).toBe(anchorDoc);
        expect(original.viewState.scrollTop).toBe(modified.viewState.scrollTop);
        pane.dispose();
    });

    it("a hunk covering the cursor of the OTHER side expands on recompute", async () => {
        // An edit in original does not touch the modified cursor sitting in the hidden part of the region.
        const base = Array.from({ length: 40 }, (_, i) => `line${String(i)}`).join("\n");
        const original = ownedModel(base);
        const modified = ownedModel(base);
        const pane = makePane(
            { kind: "owned", model: original },
            { kind: "owned", model: modified },
            { debounceMs: 0 },
        );
        const sidePanes = pane.sidePanes();
        expect(sidePanes[1].viewState.foldedRegions.some((r) => r.isCollapsed)).toBe(true);

        sidePanes[1].viewState.selections = [
            { anchor: { line: 20, character: 0 }, active: { line: 20, character: 0 } },
        ];
        sidePanes[0].viewState.type("X"); // edit original on line 0
        await settle(5);

        expect(sidePanes[1].viewState.logicalToVisualLine(20)).toBeGreaterThanOrEqual(0);
        pane.dispose();
    });

    it("merged hunks inherit collapsed state from the larger overlap", async () => {
        // Two changes split the file into two unchanged regions; expand the first,
        // then remove the first change with an edit — the regions merge into one.
        const base = Array.from({ length: 40 }, (_, i) => `line${String(i)}`);
        const originalText = base.join("\n");
        const modifiedLines = [...base];
        modifiedLines[10] = "CHANGED10";
        modifiedLines[30] = "CHANGED30";
        const model = ownedModel(modifiedLines.join("\n"));
        const pane = makePane(originalText, { kind: "owned", model }, { debounceMs: 0 });
        const { modified } = sides(pane);

        const collapsed = modified.viewState.foldedRegions.filter((r) => r.isCollapsed);
        expect(collapsed.length).toBeGreaterThanOrEqual(2);
        modified.viewState.toggleFold(collapsed[0].startLine);
        await settle(5);

        modified.applyExternalEdits(
            [{ range: { start: { line: 10, character: 0 }, end: { line: 10, character: 9 } }, text: "line10" }],
            "revert",
        );
        await settle(5);

        expect(pane.sidePanes()[0].viewState.getViewLineCount()).toBe(modified.viewState.getViewLineCount());
        pane.dispose();
    });

    it("a region without previous pairs collapses, hiding the scroll anchor without a jump", async () => {
        // The sides differ completely; replacing the snapshot makes them identical — the first
        // region (no previous pairs, so collapsed) hides the old viewport anchor.
        const originalText = Array.from({ length: 40 }, (_, i) => `A${String(i)}`).join("\n");
        const modifiedText = Array.from({ length: 40 }, (_, i) => `B${String(i)}`).join("\n");
        const pane = makePane(originalText, modifiedText, { debounceMs: 0 });
        const { modified } = sides(pane);
        expect(modified.viewState.foldedRegions).toHaveLength(0);
        modified.viewState.scrollTop = 20;

        pane.replaceSnapshotContent("original", modifiedText);
        await settle(5);

        expect(modified.viewState.foldedRegions.some((r) => r.isCollapsed)).toBe(true);
        pane.dispose();
    });

    it("revert hunk: a modified pair returns to original, the edit is undoable", async () => {
        const original = "alpha\nbravo\ncharlie";
        const model = ownedModel("alpha\nBRAVO\ncharlie");
        const pane = makePane(original, { kind: "owned", model }, { debounceMs: 0 });
        const { modified } = sides(pane);

        modified.goToPosition(1, 0);
        expect(pane.revertHunkAtCaret()).toBe("reverted");
        expect(modified.getText()).toBe("alpha\nbravo\ncharlie");

        modified.undo();
        expect(modified.getText()).toBe("alpha\nBRAVO\ncharlie");
        await settle(5);
        pane.dispose();
    });

    it("revert hunk: added lines are removed, deleted ones come back", async () => {
        const added = ownedModel("alpha\nNEW1\nNEW2\nbravo");
        const addedPane = makePane("alpha\nbravo", { kind: "owned", model: added }, { debounceMs: 0 });
        addedPane.sidePanes()[1].goToPosition(2, 0);
        expect(addedPane.revertHunkAtCaret()).toBe("reverted");
        expect(added.getText()).toBe("alpha\nbravo");
        addedPane.dispose();

        // A block removed from modified: the cursor is on the removed lines in the ORIGINAL
        // side (the modified range is empty) — the lines come back.
        const removed = ownedModel("alpha\ndelta");
        const removedPane = makePane(
            "alpha\nbravo\ncharlie\ndelta",
            { kind: "owned", model: removed },
            { debounceMs: 0 },
        );
        removedPane.sidePanes()[0].component.focus();
        removedPane.sidePanes()[0].goToPosition(1, 0);
        expect(removedPane.revertHunkAtCaret()).toBe("reverted");
        expect(removed.getText()).toBe("alpha\nbravo\ncharlie\ndelta");
        await settle(5);
        removedPane.dispose();
    });

    it("revert hunk: trailing edge cases — deletion to end of file and insertion past the end", async () => {
        // An added tail (removed together with the separator on its left).
        const tail = ownedModel("alpha\nbravo\nTAIL");
        const tailPane = makePane("alpha\nbravo", { kind: "owned", model: tail }, { debounceMs: 0 });
        tailPane.sidePanes()[1].goToPosition(2, 0);
        expect(tailPane.revertHunkAtCaret()).toBe("reverted");
        expect(tail.getText()).toBe("alpha\nbravo");
        tailPane.dispose();

        // A removed tail of original: insertion past the end of modified.
        const cut = ownedModel("alpha");
        const cutPane = makePane("alpha\nomega", { kind: "owned", model: cut }, { debounceMs: 0 });
        cutPane.sidePanes()[0].component.focus();
        cutPane.sidePanes()[0].goToPosition(1, 0);
        expect(cutPane.revertHunkAtCaret()).toBe("reverted");
        expect(cut.getText()).toBe("alpha\nomega");
        await settle(5);
        cutPane.dispose();
    });

    it("revert hunk: outside a hunk — no-hunk, snapshot modified side — read-only", async () => {
        const model = ownedModel("alpha\nBRAVO\ncharlie");
        const pane = makePane("alpha\nbravo\ncharlie", { kind: "owned", model }, { debounceMs: 0 });
        pane.sidePanes()[1].goToPosition(0, 0);
        expect(pane.revertHunkAtCaret()).toBe("no-hunk");
        pane.dispose();

        const frozen = makePane("alpha", "ALPHA");
        expect(frozen.revertHunkAtCaret()).toBe("read-only");
        await settle(5);
        frozen.dispose();
    });

    it("replaceSnapshotContent: same text — no-op, new text — recompute and live sync", async () => {
        const pane = makePane("a\nb\nc", "a\nB\nc", { debounceMs: 0 });
        const { original, modified } = sides(pane);
        const viewStateBefore = original.viewState;
        const versionBefore = original.model.document.versionId;

        pane.replaceSnapshotContent("original", "a\nb\nc");
        expect(original.model.document.versionId).toBe(versionBefore);
        expect(original.viewState).toBe(viewStateBefore);

        pane.replaceSnapshotContent("original", "a\nb2\nc");
        await settle(5);
        expect(original.viewState).toBe(viewStateBefore);
        expect(original.viewState.getViewLineCount()).toBe(modified.viewState.getViewLineCount());
        modified.viewState.scrollTop = 1;
        expect(original.viewState.scrollTop).toBe(1);

        const ownPane = makePane("x", { kind: "owned", model: ownedModel("x") });
        ownPane.replaceSnapshotContent("modified", "y");
        expect(ownPane.sidePanes()[1].getText()).toBe("x");
        ownPane.dispose();
        pane.dispose();
    });

    it("replacing the snapshot recomputes the layout immediately and keeps expansion; an edit waits for the pause", () => {
        const base = Array.from({ length: 40 }, (_, i) => `line${String(i)}`).join("\n");
        const model = ownedModel(`${base}\nnew tail`);
        const pane = makePane(base, { kind: "owned", model }, { debounceMs: 60_000 });
        const { original, modified } = sides(pane);
        const region = modified.viewState.foldedRegions.find((r) => r.isCollapsed);
        modified.viewState.toggleFold(region?.startLine ?? 0);

        modified.goToPosition(40, 0);
        modified.viewState.type("\n");
        expect(original.viewState.getViewLineCount()).not.toBe(modified.viewState.getViewLineCount());

        pane.replaceSnapshotContent("original", `${base}\nother tail`);
        expect(original.viewState.getViewLineCount()).toBe(modified.viewState.getViewLineCount());
        expect(modified.viewState.foldedRegions.some((r) => r.isCollapsed)).toBe(false);
        pane.dispose();
    });

    it("inline mode: modified with ghost lines, original empty; switching back restores alignment", async () => {
        const original = ["keep", "dead1", "dead2", "tail"].join("\n");
        const model = ownedModel(["keep", "live", "tail"].join("\n"));
        const pane = makePane(original, { kind: "owned", model }, { debounceMs: 0 });
        const { original: left, modified: right } = sides(pane);
        expect(pane.mode).toBe("side-by-side");

        pane.setModeOverride("inline");
        await settle(5);

        expect(pane.mode).toBe("inline");
        expect(pane.activeSide).toBe("modified");
        expect(right.viewState.viewZones).toEqual([{ afterLine: 0, size: 2 }]);
        expect(left.viewState.viewZones).toEqual([]);
        expect(left.viewState.foldedRegions).toEqual([]);
        expect(left.component.view.hidden).toBe(true);

        right.goToPosition(1, 0);
        right.viewState.type("X");
        await settle(5);
        expect(right.viewState.viewZones).toEqual([{ afterLine: 0, size: 2 }]);

        pane.setModeOverride("side-by-side");
        await settle(5);
        expect(pane.mode).toBe("side-by-side");
        expect(left.component.view.hidden).toBe(false);
        expect(left.viewState.getViewLineCount()).toBe(right.viewState.getViewLineCount());
        pane.dispose();
    });

    it("inline: revert hunk works on the modified cursor, reading the hunk with its ghost lines", async () => {
        const model = ownedModel(["keep", "live", "tail"].join("\n"));
        const pane = makePane(["keep", "dead", "tail"].join("\n"), { kind: "owned", model }, { debounceMs: 0 });
        pane.setModeOverride("inline");
        await settle(5);

        // original [1..2) ↔ modified [1..2) — a regular pair.
        pane.sidePanes()[1].goToPosition(1, 0);
        expect(pane.revertHunkAtCaret()).toBe("reverted");
        expect(model.getText()).toBe(["keep", "dead", "tail"].join("\n"));
        await settle(5);
        pane.dispose();
    });

    it("a mode change on a disposed pane is a no-op (dispose outruns the microtask)", async () => {
        const pane = makePane("a", "b");
        pane.setModeOverride("inline"); // the apply microtask is still queued
        pane.dispose();
        await settle(5);
        expect(pane.mode).toBe("inline"); // the element switched; the pane silently did not
    });

    it("the pair element's inspectState carries the mode and override (e2e selectors)", () => {
        const pane = makePane("a", "b");
        expect(pane.view.inspectState()).toEqual({ mode: "side-by-side", override: "auto" });
        pane.dispose();
    });

    it("refreshDiffSnapshots on a pane opened bypassing openDiffPair is a silent no-op", async () => {
        const pane = makePane("a", "b");
        await refreshDiffSnapshots(new FileService(), pane);
        expect(pane.sidePanes()[0].getText()).toBe("a");
        // Such a pane has no recipe either — a split will not reproduce it.
        expect(diffPaneRecipe(pane)).toBeUndefined();
        pane.dispose();
    });

    it("onDidChangeState merges side events; a disposed subscription is removed", async () => {
        const model = ownedModel("x");
        const pane = makePane("x", { kind: "owned", model }, { debounceMs: 0 });
        let fired = 0;
        const subscription = pane.onDidChangeState(() => {
            fired++;
        });

        pane.sidePanes()[1].viewState.type("y");
        expect(fired).toBeGreaterThan(0);

        const before = fired;
        subscription.dispose();
        pane.sidePanes()[1].viewState.type("z");
        expect(fired).toBe(before);
        await settle(5);
        pane.dispose();
    });
});

describe("Workbench — diff v2", () => {
    let ws: ITempWorkspace;
    let workbench: WorkbenchComponent;
    let editors: IEditorService;
    let app: TestApp;
    let container: ReturnType<typeof createTestContainer>["container"];
    let headContent: string;
    let fireGitChange: ((uris: readonly Uri[]) => void) | null;

    beforeEach(async () => {
        ws = createTempWorkspace({ prefix: "diode-diffv2-", files: { "a.txt": AT_HEAD } });
        const testContainer = createTestContainer();
        container = testContainer.container;
        const registry = diskFileService();
        headContent = AT_HEAD;
        fireGitChange = null;
        registry.registerProvider("git", {
            capabilities: FileSystemProviderCapabilities.Readonly,
            readFile: () => Promise.resolve(new TextEncoder().encode(headContent)),
            onDidChangeFile: (cb) => {
                fireGitChange = cb;
                return {
                    dispose: () => {
                        fireGitChange = null;
                    },
                };
            },
        });
        container.bind(IFileServiceDIToken, () => registry);
        // In-memory state instead of the NULL stub: the US-22 toggle persists the mode.
        const stateStore = new Map<string, unknown>();
        container.bind(StateServiceDIToken, () => ({
            get: (descriptor) => (stateStore.get(descriptor.key) ?? descriptor.default) as never,
            store: (descriptor, value) => {
                stateStore.set(descriptor.key, value);
            },
            remove: () => undefined,
            openWorkspace: () => undefined,
            flushSync: () => undefined,
            dispose: () => undefined,
            onDidOpenWorkspace: Event.None,
        }));
        workbench = container.get(WorkbenchComponentDIToken);
        editors = container.get(EditorServiceDIToken);
        container
            .get(CommandRegistryDIToken)
            .register(ORIGINAL_RESOURCE_COMMAND, (raw) =>
                Uri.from({ scheme: "git", path: String(raw), query: '{"ref":"HEAD"}' }).toString(),
            );
        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        app = TestApp.create(workbench.view, new Size(140, 24));
        testContainer.bindApp(app.app);
        container.get(CommandRegistryDIToken).execute("workbench.openFile", ws.path("a.txt"));
        await settle(0);
    });

    afterEach(() => {
        workbench.dispose();
        ws.dispose();
    });

    async function openV2(): Promise<DiffEditorPane2> {
        const editor = editors.getActiveEditor();
        editor?.goToPosition(14, 0);
        editor?.viewState.type("XX");
        container.get(CommandRegistryDIToken).execute("diode.scm.compareWithHead");
        await settle(20);
        app.render();
        const pane = editors.getActiveTabPane();
        expect(pane instanceof DiffEditorPane2).toBe(true);
        return pane as DiffEditorPane2;
    }

    it("the tab is two real editors: pairs at the same height, markers, banners", async () => {
        await openV2();

        const lines = app.backend
            .screenToString()
            .split("\n")
            .map((l) => l.replace(/\s+$/, ""));
        const pair = lines.find((l) => l.includes("old line") && l.includes("XXold line"));
        expect(pair).toBeDefined();
        expect(pair).toMatch(/15-.*│.*15\+/u);
        const plaque = lines.find((l) => l.includes("unchanged lines"));
        expect(plaque).toBeDefined();
        expect(plaque?.split("│").filter((part) => part.includes("unchanged lines"))).toHaveLength(2);
    });

    it("the modified side is the file's live buffer: an edit in the diff is visible in the file tab", async () => {
        const fileEditor = editors.getActiveEditor();
        const pane = await openV2();

        expect(pane.activeTextPane.model === fileEditor?.model).toBe(true);
        expect(pane.readOnly).toBe(false);
        expect(pane.isModified).toBe(true);

        pane.activeTextPane.goToPosition(15, 0);
        pane.activeTextPane.viewState.type("Y");
        expect(fileEditor?.getText()).toContain("Ytail");
    });

    it("an edit from the file tab updates the diff after debounce", async () => {
        const fileEditor = editors.getActiveEditor();
        const pane = await openV2();
        const [original, modified] = pane.sidePanes();

        // Edit through the file tab, even though it is not active: the model is shared.
        fileEditor?.applyExternalEdits(
            [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "W" }],
            "test",
        );
        await settle(250); // debounce 200

        expect(original.viewState.getViewLineCount()).toBe(modified.viewState.getViewLineCount());
        app.render();
        const lines = app.backend.screenToString().split("\n");
        expect(lines.find((l) => l.includes("Wconst value0") && l.includes("const value0"))).toBeDefined();
    });

    it("getActiveEditor returns the active side — cursor commands work", async () => {
        const pane = await openV2();

        const sideEditor = editors.getActiveEditor();
        expect(sideEditor).not.toBeNull();
        expect(sideEditor === pane.activeTextPane).toBe(true);
        expect(sideEditor?.readOnly).toBe(false);
        expect(pane.sidePanes()[0].readOnly).toBe(true);

        const before = sideEditor?.viewState.selections[0].active.line ?? -1;
        container.get(CommandRegistryDIToken).execute("cursorDown");
        const after = sideEditor?.viewState.selections[0].active.line ?? -1;
        expect(after).toBeGreaterThan(before);
        expect(sideEditor?.viewState.logicalToVisualLine(after)).toBeGreaterThan(0);
    });

    it("scroll is mirrored between the sides", async () => {
        const pane = await openV2();

        pane.viewState.scrollTop = 3;
        app.render();

        expect(pane.activeSide).toBe("modified");
        expect(pane.sidePanes()[0].viewState.scrollTop).toBe(3);
    });

    it("expanding a collapsed hunk expands the pair and removes the banners", async () => {
        const pane = await openV2();
        const modified = pane.activeTextPane.viewState;
        const collapsedRegion = modified.foldedRegions.find((r) => r.isCollapsed);
        expect(collapsedRegion).toBeDefined();

        modified.toggleFold(collapsedRegion?.startLine ?? 0);
        await settle(10);
        app.render();

        const original = pane.sidePanes()[0];
        expect(original.viewState.foldedRegions.some((r) => r.isCollapsed)).toBe(false);
        expect(app.backend.screenToString()).not.toContain("unchanged lines");
        expect(original.viewState.getViewLineCount()).toBe(modified.getViewLineCount());
    });

    it("getSelectedTexts returns the active side's text without filler lines", async () => {
        const pane = await openV2();

        pane.viewState.selections = [{ anchor: { line: 14, character: 0 }, active: { line: 14, character: 6 } }];

        expect(pane.getSelectedTexts()).toEqual(["XXold "]);
    });

    it("focus in the left column switches the active side", async () => {
        const pane = await openV2();
        expect(pane.activeSide).toBe("modified");

        pane.sidePanes()[0].component.focus();

        expect(pane.activeSide).toBe("original");
        expect(editors.getActiveEditor() === pane.activeTextPane).toBe(true);
    });

    it("commands without an active file and without git — silent no-op and a notice", async () => {
        editors.editorGroups.activeGroup.closeTab(editors.editorGroups.activeGroup.activeIndex);
        container.get(CommandRegistryDIToken).execute("diode.scm.compareWithHead");
        await settle(20);
        expect(editors.editorGroups.activeGroup.editorCount).toBe(0);

        const bare = createTempWorkspace({ prefix: "diode-diffv2-bare-", files: { "b.txt": "x\n" } });
        try {
            container.get(CommandRegistryDIToken).execute("workbench.openFile", bare.path("b.txt"));
            await settle(0);
            container.get(CommandRegistryDIToken).register(ORIGINAL_RESOURCE_COMMAND, () => null);
            container.get(CommandRegistryDIToken).execute("diode.scm.compareWithHead");
            await settle(20);
            app.render();
            expect(app.backend.screenToString()).toContain("No changes to compare");
        } finally {
            bare.dispose();
        }
    });

    it("the tab closes without a dialog (the model lives on in the file tab), reopening updates in place", async () => {
        await openV2();
        const countAfterFirst = editors.editorGroups.activeGroup.editorCount;

        // A repeated call WITH the diff tab active targets its source file.
        container.get(CommandRegistryDIToken).execute("diode.scm.compareWithHead");
        await settle(20);
        expect(editors.editorGroups.activeGroup.editorCount).toBe(countAfterFirst);

        // Unsaved edits live in the file model — the diff closes silently.
        editors.editorGroups.activeGroup.closeTab(editors.editorGroups.activeGroup.activeIndex);
        expect(editors.editorGroups.activeGroup.editorCount).toBe(countAfterFirst - 1);
    });

    it("US-31: a HEAD change (provider onDidChangeFile) refreshes the snapshot side by itself", async () => {
        const pane = await openV2();
        const original = pane.sidePanes()[0];
        expect(original.getText()).toContain("old line");

        // "Commit from the terminal": HEAD now equals the buffer.
        headContent = AT_HEAD.replace("old line", "XXold line");
        expect(pane.originalUri).not.toBeNull();
        // A burst of events (rebase touches .git several times) is collapsed by the debounce.
        fireGitChange?.([pane.originalUri!]);
        fireGitChange?.([pane.originalUri!]);
        // Contribution debounce (200) + read + recompute.
        await settle(300);

        expect(original.getText()).toContain("XXold line");
        // The sides are now equal and the diff says so (the notice zone sits above the first
        // line; the scroll anchor kept the content in place, so scroll up to it).
        pane.activeTextPane.viewState.scrollTop = 0;
        app.render();
        expect(app.backend.screenToString()).toContain("The files are identical");

        fireGitChange?.([Uri.from({ scheme: "git", path: "/elsewhere" })]);
        await settle(300);
        expect(original.getText()).toContain("XXold line");
    });

    it("Diff: Revert Hunk — the command reverts the hunk under the cursor, outside a hunk — a notice", async () => {
        const fileEditor = editors.getActiveEditor();
        await openV2();

        const side = editors.getActiveEditor();
        side?.goToPosition(14, 0);
        container.get(CommandRegistryDIToken).execute("diode.diff.revertHunk");
        await settle(20);

        expect(fileEditor?.getText()).not.toContain("XXold line");
        expect(fileEditor?.getText()).toContain("old line");

        side?.goToPosition(0, 0);
        container.get(CommandRegistryDIToken).execute("diode.diff.revertHunk");
        await settle(20);
        app.render();
        expect(app.backend.screenToString()).toContain("No change under the cursor");

        editors.editorGroups.activeGroup.activateTab(0);
        container.get(CommandRegistryDIToken).execute("diode.diff.revertHunk");
        await settle(20);
        expect(fileEditor?.getText()).toContain("old line");
    });

    it("color decorators: the built-in detector draws its squares in the file tab and on both diff sides", async () => {
        container
            .get(CommandRegistryDIToken)
            .execute("workbench.openFile", ws.writeFile("c.css", "a { color: #fff; }"));
        await settle(20);
        app.render();
        expect(app.backend.screenToString()).toContain("a { color: ■ #fff; }");

        await openDiffPair(container, {
            original: { text: "left: #123", label: "L", identity: "l" },
            modified: { text: "right: #456", label: "R", identity: "r" },
        });
        await settle(20);
        app.render();
        const screen = app.backend.screenToString();
        expect(screen).toContain("left: ■ #123");
        expect(screen).toContain("right: ■ #456");
    });

    it("US-31: a side without a resource (Clipboard) does not match; dispose clears the pending timer", async () => {
        await openDiffPair(container, {
            original: { text: "clip", label: "Clipboard", identity: "c" },
            modified: { uri: Uri.file(ws.path("a.txt")), label: "a.txt", identity: "a" },
        });
        await settle(20);
        const pane = editors.getActiveTabPane() as DiffEditorPane2;
        // Plus a pair with a snapshot modified side (git resource on the right): matching
        // must check the resource of both snapshot sides.
        await openDiffPair(container, {
            original: { text: "x", label: "L", identity: "l2" },
            modified: { uri: Uri.from({ scheme: "git", path: "/head", query: "r" }), label: "R", identity: "r2" },
        });
        await settle(20);

        fireGitChange?.([Uri.from({ scheme: "git", path: "/x" })]);
        await settle(300);
        expect(pane.sidePanes()[0].getText()).toBe("clip");

        // Leave the timer pending: afterEach disposes the workbench — the contribution
        // must clear it and not fire after disposal.
        fireGitChange?.([Uri.from({ scheme: "git", path: "/y" })]);
    });

    it("Diff: Revert Hunk also works with the cursor in the original side", async () => {
        const fileEditor = editors.getActiveEditor();
        const pane = await openV2();

        pane.sidePanes()[0].component.focus();
        pane.sidePanes()[0].goToPosition(14, 0);
        container.get(CommandRegistryDIToken).execute("diode.diff.revertHunk");
        await settle(20);

        expect(fileEditor?.getText()).not.toContain("XXold line");
    });

    it("Ctrl+F searches the active side; a match in a collapsed hunk expands the pair", async () => {
        const pane = await openV2();
        pane.activeTextPane.component.focus();
        app.render();

        expect(pane.activeTextPane.viewState.logicalToVisualLine(7)).toBe(-1);
        app.sendKey("Ctrl+F");
        typeText(app, "value7");
        await settle(10);
        app.render();

        const modified = pane.activeTextPane;
        expect(modified.viewState.searchMatches.length).toBeGreaterThan(0);
        expect(modified.viewState.logicalToVisualLine(7)).toBeGreaterThanOrEqual(0);
        const original = pane.sidePanes()[0];
        expect(original.viewState.getViewLineCount()).toBe(modified.viewState.getViewLineCount());
    });

    it("US-21: narrow terminal — auto inline with ghost lines, resizing back restores the columns", async () => {
        const pane = await openV2();
        expect(pane.mode).toBe("side-by-side");

        // The pane is narrower than the threshold — inline.
        app.backend.resize(new Size(90, 24));
        await settle(10);
        app.render();

        expect(pane.mode).toBe("inline");
        const lines = app.backend.screenToString().split("\n");
        expect(lines.find((l) => l.includes("HEAD ↔ a.txt"))).toBeDefined();
        const ghost = lines.find((l) => l.includes("old line") && !l.includes("XXold line"));
        expect(ghost).toBeDefined();
        expect(ghost).not.toMatch(/15/u);
        expect(lines.find((l) => /15\+\s+XXold line/u.test(l))).toBeDefined();

        app.backend.resize(new Size(140, 24));
        await settle(10);
        app.render();
        expect(pane.mode).toBe("side-by-side");
        const [left, right] = pane.sidePanes();
        expect(left.viewState.getViewLineCount()).toBe(right.viewState.getViewLineCount());
    });

    it("US-21: focus moves from the hidden original side to modified", async () => {
        const pane = await openV2();
        pane.sidePanes()[0].component.focus();
        expect(pane.activeSide).toBe("original");

        app.backend.resize(new Size(90, 24));
        await settle(10);

        expect(pane.mode).toBe("inline");
        expect(pane.activeSide).toBe("modified");
        expect(editors.getActiveEditor() === pane.sidePanes()[1]).toBe(true);
    });

    it("US-21: switching to inline does not steal focus when it is outside the original side", async () => {
        const pane = await openV2();
        // The last active side is original, but focus has moved to the file tab.
        pane.sidePanes()[0].component.focus();
        editors.editorGroups.activeGroup.activateTab(0);
        await settle(5);
        const fileEditor = editors.getActiveTabEditor();
        expect(fileEditor).not.toBeNull();

        // Toggle on a background tab: the active side moves, focus stays on the file.
        pane.setModeOverride("inline");
        await settle(5);

        expect(pane.mode).toBe("inline");
        expect(pane.activeSide).toBe("modified");
        expect(editors.getActiveTabEditor() === fileEditor).toBe(true);
    });

    it("US-22: the toggle switches the mode of all tabs and persists for new ones", async () => {
        const pane = await openV2();
        expect(pane.mode).toBe("side-by-side");

        container.get(CommandRegistryDIToken).execute("diode.diff.toggleInlineView");
        await settle(10);
        expect(pane.mode).toBe("inline");

        // Persisted: the next diff tab opens in inline mode.
        container.get(CommandRegistryDIToken).execute("workbench.files.action.compareNewUntitledTextFiles");
        await settle(30);
        const untitled = editors.getActiveTabPane() as DiffEditorPane2;
        expect(untitled.mode).toBe("inline");

        container.get(CommandRegistryDIToken).execute("diode.diff.toggleInlineView");
        await settle(10);
        expect(untitled.mode).toBe("side-by-side");
        expect(pane.mode).toBe("side-by-side");

        editors.editorGroups.activeGroup.activateTab(0);
        container.get(CommandRegistryDIToken).execute("diode.diff.toggleInlineView");
        await settle(10);
        expect(pane.mode).toBe("side-by-side");
    });

    it("close dialog of a dirty untitled diff: Save without a path keeps the tab, Don't Save closes it", async () => {
        container.get(CommandRegistryDIToken).execute("workbench.files.action.compareNewUntitledTextFiles");
        await settle(30);
        const pane = editors.getActiveTabPane();
        expect(pane instanceof DiffEditorPane2).toBe(true);
        (pane as DiffEditorPane2).sidePanes()[1].viewState.type("keepme");

        const dialogs = container.get(DialogServiceDIToken);
        void editors.closeEditor(editors.editorGroups.activeGroup, editors.editorGroups.activeGroup.activeIndex);
        await settle(10);
        app.render();
        expect(app.backend.screenToString()).toContain("Untitled-2");

        // Save: untitled has no path ("no-file") — the text must not silently vanish,
        // so the tab stays open.
        dialogs.getOpenConfirmSaveDialog()?.onSave?.();
        await settle(10);
        expect(editors.getActiveTabPane()).toBe(pane);

        void editors.closeEditor(editors.editorGroups.activeGroup, editors.editorGroups.activeGroup.activeIndex);
        await settle(10);
        dialogs.getOpenConfirmSaveDialog()?.onDontSave?.();
        await settle(10);
        expect(editors.editorGroups.activeGroup.getPanes().includes(pane as DiffEditorPane2)).toBe(false);
    });

    it("close dialog of a diff with a file side: Save writes the file and closes the tab", async () => {
        await openV2();
        // The file tab is closed — the dirty model lives only in the diff side.
        editors.editorGroups.activeGroup.closeTab(0);
        const pane = editors.getActiveTabPane() as DiffEditorPane2;
        expect(editors.needsCloseConfirm(pane)).toBe(true);

        const dialogs = container.get(DialogServiceDIToken);
        void editors.closeEditor(editors.editorGroups.activeGroup, editors.editorGroups.activeGroup.activeIndex);
        await settle(10);
        dialogs.getOpenConfirmSaveDialog()?.onSave?.();

        await vi.waitFor(() => {
            expect(editors.editorGroups.activeGroup.getPanes().includes(pane)).toBe(false);
        });
        const { readFileSync } = await import("node:fs");
        expect(readFileSync(ws.path("a.txt"), "utf8")).toContain("XXold line");
    });

    it("closeEditorsInGroup asks about a dirty diff; Cancel keeps it, Don't Save closes it", async () => {
        container.get(CommandRegistryDIToken).execute("workbench.files.action.compareNewUntitledTextFiles");
        await settle(30);
        const pane = editors.getActiveTabPane() as DiffEditorPane2;
        pane.sidePanes()[1].viewState.type("dirty");
        const dialogs = container.get(DialogServiceDIToken);

        container.get(CommandRegistryDIToken).execute("workbench.action.closeEditorsInGroup");
        await settle(10);
        dialogs.getOpenConfirmSaveDialog()?.onCancel?.();
        await settle(10);
        expect(editors.editorGroups.activeGroup.getPanes().includes(pane)).toBe(true);

        container.get(CommandRegistryDIToken).execute("workbench.action.closeEditorsInGroup");
        await settle(10);
        dialogs.getOpenConfirmSaveDialog()?.onDontSave?.();
        await settle(10);
        expect(editors.editorGroups.activeGroup.getPanes().includes(pane)).toBe(false);
    });

    it("closing the file tab while the diff is open — no dialog: the edits live in the side", async () => {
        await openV2();

        // Close the file tab (index 0): the model is dirty, but the diff side
        // holds the same document — no dialog needed.
        editors.editorGroups.activeGroup.activateTab(0);
        const fileEditor = editors.getActiveTabEditor();
        expect(fileEditor?.isModified).toBe(true);
        expect(editors.needsCloseConfirm(fileEditor!)).toBe(false);
        expect(await editors.closeEditor(editors.editorGroups.activeGroup, fileEditor!)).toBe(true);
        expect(container.get(DialogServiceDIToken).getOpenConfirmSaveDialog()).toBeNull();

        // After that the diff is the document's last surface, so it does need the dialog.
        const diffPane = editors.getActiveTabPane() as DiffEditorPane2;
        expect(editors.needsCloseConfirm(diffPane)).toBe(true);
        expect(editors.dirtyExclusiveDiffSides(diffPane).map((s) => s.label)).toEqual(["a.txt"]);
    });
});
