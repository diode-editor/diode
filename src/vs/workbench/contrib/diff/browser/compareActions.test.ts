import * as fs from "node:fs";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { quickPickByTitle, tabLabels } from "../../../../../TestUtils/domQueries.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Event } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { ClipboardDIToken } from "../../../../platform/clipboard/common/iClipboard.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { FileSystemProviderCapabilities, IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import { DiffEditorPane2 } from "../../../browser/parts/editor/diffEditorPane2.ts";
import type { IEditorGroupsService } from "../../../services/editor/common/editorGroupsService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { ORIGINAL_RESOURCE_COMMAND } from "../../scm/browser/commandOriginalResourceProvider.ts";
import { QUERY_COMMAND } from "../../scm/browser/syncActions.ts";

import { resetSelectedForCompare } from "./compareActions.ts";

// Here: side selection and entry points (pickers, menus, clipboard); tab mechanics are in openDiffPair.test.ts.

/** The view's group focus hook is wrapped, not replaced. */
function recordGroupFocus(groups: IEditorGroupsService): number[] {
    const focused: number[] = [];
    const viewHook = groups.focusGroupContentHook;
    groups.focusGroupContentHook = (group) => {
        focused.push(groups.viewColumnOf(group));
        viewHook?.(group);
    };
    return focused;
}

describe("File compare commands", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-compare-",
            files: { "a.txt": "alpha\nbravo\n", "b.txt": "alpha\nBRAVO\n" },
        });
        // Wider than the inline fallback threshold: the command family checks side-by-side
        // semantics; inline mode is tested in diffEditorPane2.test.ts.
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(150, 24) });
        resetSelectedForCompare();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function diffPanes() {
        return h.container
            .get(EditorServiceDIToken)
            .editorGroups.activeGroup.getPanes()
            .filter((p) => p instanceof DiffEditorPane2);
    }

    /** Opening the tab is async (reading the sides); under load 10ms is not enough. */
    async function settleUntilDiff(): Promise<void> {
        for (let i = 0; i < 50 && diffPanes().length === 0; i++) await settle(10);
        h.testApp.render();
    }

    async function openAndEdit(name: string): Promise<void> {
        h.commands.execute("workbench.openFile", ws.path(name));
        await settle(0);
        const editor = h.container.get(EditorServiceDIToken).getActiveEditor();
        editor?.goToPosition(1, 0);
        editor?.viewState.type("XX");
        h.testApp.render();
    }

    describe("Compare with Saved (US-6)", () => {
        it("opens a 'disk ↔ buffer' diff with side labels", async () => {
            await openAndEdit("a.txt");

            h.commands.execute("workbench.files.action.compareWithSaved");
            await settleUntilDiff();

            const screen = h.testApp.backend.screenToString();
            expect(screen).toContain("a.txt (on disk) ↔ a.txt");
            expect(screen).toMatch(/2-\s+bravo/u);
            expect(screen).toMatch(/2\+\s+XXbravo/u);
        });

        it("an unmodified file gives a 'The files are identical' tab (US-11)", async () => {
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);

            h.commands.execute("workbench.files.action.compareWithSaved");
            await settleUntilDiff();

            // Narrow side-by-side columns may truncate the end of the phrase, so anchor on the start.
            expect(h.testApp.backend.screenToString()).toMatch(/The files are iden/u);
        });

        it("an untitled buffer gets a notice instead of a tab", async () => {
            h.commands.execute("workbench.action.files.newUntitledFile");
            await settle(0);

            h.commands.execute("workbench.files.action.compareWithSaved");
            await settleUntilDiff();

            expect(h.testApp.backend.screenToString()).toContain("no saved version on disk");
            expect(diffPanes()).toHaveLength(0);
        });
    });

    describe("Compare with Clipboard (US-5)", () => {
        it("compares clipboard contents with the active file", async () => {
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);
            await h.container.get(ClipboardDIToken).writeText("alpha\nCLIP\n");

            h.commands.execute("workbench.files.action.compareWithClipboard");
            await settleUntilDiff();

            const screen = h.testApp.backend.screenToString();
            expect(screen).toContain("Clipboard ↔ a.txt");
            expect(screen).toMatch(/2-\s+CLIP/u);
            expect(screen).toMatch(/2\+\s+bravo/u);
        });

        it("empty clipboard compares against empty, not an error", async () => {
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);

            h.commands.execute("workbench.files.action.compareWithClipboard");
            await settleUntilDiff();

            expect(h.testApp.backend.screenToString()).toMatch(/1\+\s+alpha/u);
        });
    });

    describe("Select for Compare / Compare with Selected (US-4)", () => {
        it("a pair from the Explorer menu opens a diff, the first selected on the left", async () => {
            h.commands.execute("selectForCompare", ws.path("a.txt"));
            expect(h.container.get(ContextKeyServiceDIToken).evaluate("resourceSelectedForCompare")).toBe(true);

            h.commands.execute("compareFiles", ws.path("b.txt"));
            await settleUntilDiff();

            const screen = h.testApp.backend.screenToString();
            expect(screen).toContain("a.txt ↔ b.txt");
            expect(screen).toMatch(/2-\s+bravo/u);
            expect(screen).toMatch(/2\+\s+BRAVO/u);
        });

        it("Compare with Selected before Select for Compare is a silent no-op", async () => {
            h.commands.execute("compareFiles", ws.path("b.txt"));
            await settle(10);

            expect(diffPanes()).toHaveLength(0);
        });

        it("right file gone from disk: a notice instead of a tab", async () => {
            h.commands.execute("selectForCompare", ws.path("a.txt"));
            const { rmSync } = await import("node:fs");
            rmSync(ws.path("b.txt"));

            h.commands.execute("compareFiles", ws.path("b.txt"));
            await settleUntilDiff();

            expect(h.testApp.backend.screenToString()).toContain("file is not readable");
            expect(diffPanes()).toHaveLength(0);
        });

        it("a repeated Select for Compare replaces the pending file", async () => {
            h.commands.execute("selectForCompare", ws.path("a.txt"));
            h.commands.execute("selectForCompare", ws.path("b.txt"));

            h.commands.execute("compareFiles", ws.path("a.txt"));
            await settleUntilDiff();

            expect(h.testApp.backend.screenToString()).toContain("b.txt ↔ a.txt");
        });
    });

    describe("Compare Active File With... (US-3, US-9)", () => {
        it("the picker opens a diff with the picked file, the active one on the left", async () => {
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);

            h.commands.execute("workbench.files.action.compareFileWith");
            await settleUntilDiff();

            const picker = quickPickByTitle(h.testApp, "Compare Active File With...");
            const items = picker.items;
            const bIndex = items.findIndex((i) => i.label === "b.txt");
            expect(bIndex).toBeGreaterThanOrEqual(0);
            picker.setActiveIndex(bIndex);
            h.testApp.sendKey("Enter");
            await settleUntilDiff();

            expect(h.testApp.backend.screenToString()).toContain("a.txt ↔ b.txt");
        });

        it("Esc in the picker opens nothing", async () => {
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);

            h.commands.execute("workbench.files.action.compareFileWith");
            await settleUntilDiff();
            h.testApp.sendKey("Escape");
            await settle(10);

            expect(diffPanes()).toHaveLength(0);
        });
    });

    describe("Compare with Revision (US-7)", () => {
        function stubGit(refs: { name: string; kind: string; sha: string; subject: string }[]): {
            requestedRefs: string[];
        } {
            const requestedRefs: string[] = [];
            h.commands.register(QUERY_COMMAND, () => ({ refs }));
            h.commands.register(ORIGINAL_RESOURCE_COMMAND, (raw, ref) => {
                requestedRefs.push(String(ref));
                return Uri.from({
                    scheme: "git",
                    path: String(raw).replace("file://", ""),
                    query: JSON.stringify({ ref: String(ref) }),
                }).toString();
            });
            return { requestedRefs };
        }

        it("the ref picker opens a diff against the picked revision", async () => {
            const git = stubGit([{ name: "dev", kind: "head", sha: "abc1234def", subject: "wip" }]);
            h.container.get(IFileServiceDIToken).registerProvider("git", {
                capabilities: FileSystemProviderCapabilities.Readonly,
                readFile: () => Promise.resolve(new TextEncoder().encode("alpha\nDEV\n")),
                onDidChangeFile: Event.None,
            });
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);

            h.commands.execute("diode.scm.compareWithRevision");
            await settleUntilDiff();

            const picker = quickPickByTitle(h.testApp, "Compare Active File with Revision");
            expect(picker.items.map((i) => i.label)).toContain("dev");
            h.testApp.sendKey("Enter");
            await settleUntilDiff();

            // The original provider got exactly the selected ref: a producer test.
            // (The first call without a ref is the live gutter on file open.)
            expect(git.requestedRefs.at(-1)).toBe("dev");
            const screen = h.testApp.backend.screenToString();
            expect(screen).toContain("a.txt ↔ dev");
            expect(screen).toMatch(/2-\s+DEV/u);
        });

        it("no refs: a notice, the picker does not open", async () => {
            stubGit([]);
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);

            h.commands.execute("diode.scm.compareWithRevision");
            await settleUntilDiff();

            expect(h.testApp.backend.screenToString()).toContain("No refs to pick from");
            expect(diffPanes()).toHaveLength(0);
        });

        it("Open File at Revision: a read-only `name (ref)` tab with the revision content", async () => {
            stubGit([{ name: "dev", kind: "head", sha: "abc1234def", subject: "wip" }]);
            h.container.get(IFileServiceDIToken).registerProvider("git", {
                capabilities: FileSystemProviderCapabilities.Readonly,
                readFile: () => Promise.resolve(new TextEncoder().encode("alpha\nDEV\n")),
                onDidChangeFile: Event.None,
            });
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);

            h.commands.execute("diode.scm.openFileAtRevision");
            await settle(50);
            h.testApp.render();
            quickPickByTitle(h.testApp, "Open File at Revision");
            h.testApp.sendKey("Enter");
            await settle(50);
            h.testApp.render();

            const editors = h.container.get(EditorServiceDIToken);
            const snapshot = editors.getActiveTabEditor();
            expect(snapshot?.label).toBe("a.txt (dev)");
            expect(snapshot?.readOnly).toBe(true);
            expect(snapshot?.getText()).toBe("alpha\nDEV\n");
            expect(h.testApp.backend.screenToString()).toContain("DEV");

            // A repeat call for the same revision gives the same tab, not a duplicate.
            const countBefore = editors.editorGroups.activeGroup.editorCount;
            h.commands.execute("diode.scm.openFileAtRevision");
            await settle(50);
            h.testApp.render();
            // The snapshot is a TextEditorPane too: go back to the source file.
            h.testApp.sendKey("Escape");
            editors.editorGroups.activeGroup.activateTab(0);
            h.commands.execute("diode.scm.openFileAtRevision");
            await settle(50);
            h.testApp.render();
            h.testApp.sendKey("Enter");
            await settle(50);
            expect(editors.editorGroups.activeGroup.editorCount).toBe(countBefore);
        });

        it("Open File at Revision: original provider threw, a 'no version in git' notice", async () => {
            stubGit([{ name: "dev", kind: "head", sha: "abc1234def", subject: "wip" }]);
            h.commands.register(ORIGINAL_RESOURCE_COMMAND, () => {
                throw new Error("git exploded");
            });
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);
            const countBefore = h.container.get(EditorServiceDIToken).editorGroups.activeGroup.editorCount;

            h.commands.execute("diode.scm.openFileAtRevision");
            await settle(50);
            h.testApp.render();
            h.testApp.sendKey("Enter");
            await settle(50);
            h.testApp.render();

            expect(h.testApp.backend.screenToString()).toContain("no version in git");
            expect(h.container.get(EditorServiceDIToken).editorGroups.activeGroup.editorCount).toBe(countBefore);
        });

        it("Open File at Revision: file missing at the revision, a notice and no tab", async () => {
            stubGit([{ name: "dev", kind: "head", sha: "abc1234def", subject: "wip" }]);
            h.container.get(IFileServiceDIToken).registerProvider("git", {
                capabilities: FileSystemProviderCapabilities.Readonly,
                readFile: () => Promise.reject(new Error("not found")),
                onDidChangeFile: Event.None,
            });
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);
            const countBefore = h.container.get(EditorServiceDIToken).editorGroups.activeGroup.editorCount;

            h.commands.execute("diode.scm.openFileAtRevision");
            await settle(50);
            h.testApp.render();
            h.testApp.sendKey("Enter");
            await settle(50);
            h.testApp.render();

            expect(h.testApp.backend.screenToString()).toContain("does not exist on dev");
            expect(h.container.get(EditorServiceDIToken).editorGroups.activeGroup.editorCount).toBe(countBefore);
        });
    });

    describe("command edge cases", () => {
        it("without an active editor all commands are silent no-ops", async () => {
            h.commands.execute("workbench.files.action.compareWithSaved");
            h.commands.execute("workbench.files.action.compareWithClipboard");
            h.commands.execute("workbench.files.action.compareFileWith");
            h.commands.execute("diode.scm.compareWithRevision");
            h.commands.execute("diode.scm.openFileAtRevision");
            await settle(10);

            expect(diffPanes()).toHaveLength(0);
            expect(h.container.get(EditorServiceDIToken).editorGroups.activeGroup.editorCount).toBe(0);
        });

        it("selectForCompare without a path does not set the key, compareFiles without a path is a no-op", async () => {
            h.commands.execute("selectForCompare");
            expect(h.container.get(ContextKeyServiceDIToken).evaluate("resourceSelectedForCompare")).toBe(false);

            h.commands.execute("selectForCompare", ws.path("a.txt"));
            h.commands.execute("compareFiles");
            await settle(10);
            expect(diffPanes()).toHaveLength(0);
        });

        it("Saved: file gone from disk, a notice instead of a tab", async () => {
            await openAndEdit("a.txt");
            const { rmSync } = await import("node:fs");
            rmSync(ws.path("a.txt"));

            h.commands.execute("workbench.files.action.compareWithSaved");
            await settleUntilDiff();

            expect(h.testApp.backend.screenToString()).toContain("not readable from disk");
            expect(diffPanes()).toHaveLength(0);
        });
    });

    describe("Compare Active File With... — picker items", () => {
        it("an open tab is shown once with the open badge (US-9)", async () => {
            h.commands.execute("workbench.openFile", ws.path("b.txt"));
            await settle(0);
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);

            h.commands.execute("workbench.files.action.compareFileWith");
            await settleUntilDiff();

            const picker = quickPickByTitle(h.testApp, "Compare Active File With...");
            const bItems = picker.items.filter((i) => i.label === "b.txt");
            // b.txt is open and in the search index, but it appears once in the list, with a badge.
            expect(bItems).toHaveLength(1);
            expect(bItems[0].badge).toBe("open");
            h.testApp.sendKey("Escape");
        });

        it("picked file gone from disk: a notice instead of a tab", async () => {
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);

            h.commands.execute("workbench.files.action.compareFileWith");
            await settleUntilDiff();

            // The file disappears BETWEEN opening the picker and picking: the list still remembers it.
            const { rmSync } = await import("node:fs");
            rmSync(ws.path("b.txt"));
            const picker = quickPickByTitle(h.testApp, "Compare Active File With...");
            picker.setActiveIndex(picker.items.findIndex((i) => i.label === "b.txt"));
            h.testApp.sendKey("Enter");
            await settleUntilDiff();

            expect(h.testApp.backend.screenToString()).toContain("file is not readable");
            expect(diffPanes()).toHaveLength(0);
        });
    });

    describe("Compare with Revision — current branch", () => {
        it("the current branch has the current badge", async () => {
            h.commands.register(QUERY_COMMAND, () => ({
                refs: [
                    { name: "main", kind: "head", sha: "abc1234def", subject: "tip" },
                    { name: "dev", kind: "head", sha: "def5678abc", subject: "wip" },
                ],
            }));
            h.commands.execute("diode.scm.publishRepoState", {
                branch: "main",
                detached: false,
                upstream: "origin/main",
                ahead: 0,
                behind: 0,
                remotes: ["origin"],
                state: "idle",
            });
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);

            h.commands.execute("diode.scm.compareWithRevision");
            await settleUntilDiff();

            const picker = quickPickByTitle(h.testApp, "Compare Active File with Revision");
            const main = picker.items.find((i) => i.label === "main");
            const dev = picker.items.find((i) => i.label === "dev");
            expect(main?.badge).toBe("current");
            expect(dev?.badge).toBeUndefined();
            h.testApp.sendKey("Escape");
            await settle(10);
            expect(diffPanes()).toHaveLength(0);
        });

        it("original provider threw: a 'no version in git' notice", async () => {
            h.commands.register(QUERY_COMMAND, () => ({
                refs: [{ name: "dev", kind: "head", sha: "abc", subject: "x" }],
            }));
            h.commands.register(ORIGINAL_RESOURCE_COMMAND, () => {
                throw new Error("git exploded");
            });
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);

            h.commands.execute("diode.scm.compareWithRevision");
            await settleUntilDiff();
            h.testApp.sendKey("Enter");
            await settleUntilDiff();

            expect(h.testApp.backend.screenToString()).toContain("no version in git");
            expect(diffPanes()).toHaveLength(0);
        });
    });

    describe("Compare New Untitled Text Files (US-37)", () => {
        it("opens a diff of two empty untitled buffers, both sides editable right in the diff", async () => {
            h.commands.execute("workbench.files.action.compareNewUntitledTextFiles");
            await settleUntilDiff();

            expect(tabLabels(h.testApp).some((l) => l.includes("Untitled-1 ↔ Untitled-2"))).toBe(true);
            const pane = diffPanes()[0];
            expect(pane.readOnly).toBe(false);

            // Typing works in both sides; the tab does become dirty.
            const [left, right] = pane.sidePanes();
            right.viewState.type("hello");
            left.viewState.type("world");
            expect(right.getText()).toContain("hello");
            expect(left.getText()).toContain("world");
            expect(pane.isModified).toBe(true);

            // The live recompute after debounce keeps the sides aligned.
            await settle(250);
            expect(left.viewState.getViewLineCount()).toBe(right.viewState.getViewLineCount());

            // The sides are not visible anywhere else, so closing must ask.
            expect(h.container.get(EditorServiceDIToken).needsCloseConfirm(pane)).toBe(true);
        });

        it("a repeated command opens a new pair with the next numbers", async () => {
            h.commands.execute("workbench.files.action.compareNewUntitledTextFiles");
            await settleUntilDiff();
            h.commands.execute("workbench.files.action.compareNewUntitledTextFiles");
            for (let i = 0; i < 50 && diffPanes().length < 2; i++) await settle(10);

            expect(diffPanes()).toHaveLength(2);
            h.testApp.render();
            expect(tabLabels(h.testApp).some((l) => l.includes("Untitled-3 ↔ Untitled-4"))).toBe(true);
        });
    });

    describe("Diff: Revert Hunk", () => {
        it("on a diff with a snapshot modified side: a read-only notice", async () => {
            // Neither resource exists (empty): both sides are snapshots, editing is forbidden.
            h.commands.execute(
                "vscode.diff",
                Uri.file(ws.path("no1.txt")).toString(),
                Uri.file(ws.path("no2.txt")).toString(),
            );
            await settleUntilDiff();

            h.commands.execute("diode.diff.revertHunk");
            await settle(10);
            h.testApp.render();

            expect(h.testApp.backend.screenToString()).toContain("Cannot revert");
        });
    });

    describe("vscode.diff (US-12)", () => {
        it("opens a diff from a pair of uri strings with the given title", async () => {
            h.commands.execute(
                "vscode.diff",
                Uri.file(ws.path("a.txt")).toString(),
                Uri.file(ws.path("b.txt")).toString(),
                "Left ↔ Right",
            );
            await settleUntilDiff();

            expect(tabLabels(h.testApp).some((l) => l.includes("Left ↔ Right"))).toBe(true);
            expect(h.testApp.backend.screenToString()).toMatch(/2\+\s+BRAVO/u);
        });

        it("accepts Uri objects; without a title the label is built from names", async () => {
            h.commands.execute("vscode.diff", Uri.file(ws.path("a.txt")), Uri.file(ws.path("b.txt")));
            await settleUntilDiff();

            expect(tabLabels(h.testApp).some((l) => l.includes("a.txt ↔ b.txt"))).toBe(true);
        });

        it("4th argument viewColumn: Beside opens the diff in a new group (AS-20)", async () => {
            const editors = h.container.get(EditorServiceDIToken);
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);
            expect(editors.editorGroups.groups).toHaveLength(1);
            const focusedGroups = recordGroupFocus(editors.editorGroups);

            h.commands.execute(
                "vscode.diff",
                Uri.file(ws.path("a.txt")).toString(),
                Uri.file(ws.path("b.txt")).toString(),
                "",
                { viewColumn: -2 },
            );
            await settleUntilDiff();

            expect(editors.editorGroups.groups).toHaveLength(2);
            expect(editors.editorGroups.activeGroup.getPanes().some((p) => p.uri.scheme === "diode-diff")).toBe(true);
            // Prepares the column without content focus: the diff itself gets focus.
            expect(focusedGroups).toEqual([]);
        });

        it("4th argument viewColumn past the edge of the strip: a new group on the right", async () => {
            const editors = h.container.get(EditorServiceDIToken);
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);

            h.commands.execute(
                "vscode.diff",
                Uri.file(ws.path("a.txt")).toString(),
                Uri.file(ws.path("b.txt")).toString(),
                "",
                3,
            );
            await settleUntilDiff();

            expect(editors.editorGroups.groups).toHaveLength(2);
            expect(editors.editorGroups.groups[1].getPanes().some((p) => p.uri.scheme === "diode-diff")).toBe(true);
        });

        it("4th argument viewColumn as a number targets an existing column", async () => {
            const editors = h.container.get(EditorServiceDIToken);
            h.commands.execute("workbench.openFile", ws.path("a.txt"));
            await settle(0);
            editors.editorGroups.newGroup("after", { focus: false });
            editors.editorGroups.focusGroup({ index: 0 }, { focus: false });
            expect(editors.editorGroups.groups).toHaveLength(2);
            const focusedGroups = recordGroupFocus(editors.editorGroups);

            h.commands.execute(
                "vscode.diff",
                Uri.file(ws.path("a.txt")).toString(),
                Uri.file(ws.path("b.txt")).toString(),
                "",
                2,
            );
            await settleUntilDiff();

            expect(editors.editorGroups.groups).toHaveLength(2);
            expect(editors.editorGroups.groups[1].getPanes().some((p) => p.uri.scheme === "diode-diff")).toBe(true);
            expect(focusedGroups).toEqual([]);
        });

        it("garbage arguments are a silent no-op", async () => {
            h.commands.execute("vscode.diff", 42, { not: "a uri" });
            h.commands.execute("vscode.diff", Uri.file(ws.path("a.txt")).toString(), "");
            await settle(10);

            expect(diffPanes()).toHaveLength(0);
        });

        it("arguments as a single array (subprocess bridge) and uris as JSON components", async () => {
            // From an extension the command goes through commands.executeCommand: args are
            // one array, uris are serialized by their `toJSON()` into components.
            h.commands.execute("vscode.diff", [
                { scheme: "file", path: ws.path("a.txt") },
                { scheme: "file", path: ws.path("b.txt") },
                "My diff",
            ]);
            await settleUntilDiff();

            expect(tabLabels(h.testApp).some((l) => l.includes("My diff"))).toBe(true);
        });

        it("an unavailable resource gives an empty side, the tab still opens", async () => {
            h.commands.execute("vscode.diff", "untitled:missing", Uri.file(ws.path("b.txt")).toString());
            await settleUntilDiff();

            const pane = diffPanes()[0];
            expect(pane.originalUri?.toString()).toBe("untitled:missing");
            // The left side is empty, so the right text shows as added.
            expect(pane.activeTextPane.getText()).toContain("BRAVO");
        });

        it("side resources reach the tab (TabInputTextDiff)", async () => {
            const left = Uri.file(ws.path("a.txt"));
            const right = Uri.file(ws.path("b.txt"));
            h.commands.execute("vscode.diff", left.toString(), right.toString());
            await settleUntilDiff();

            const pane = diffPanes()[0];
            expect(pane.originalUri?.toString()).toBe(left.toString());
            expect(pane.modifiedUri?.toString()).toBe(right.toString());
        });

        it("a repeated diff of the same pair does not multiply tabs; file sides are live buffers", async () => {
            const left = Uri.file(ws.path("a.txt")).toString();
            const right = Uri.file(ws.path("b.txt")).toString();
            h.commands.execute("vscode.diff", left, right);
            await settleUntilDiff();
            expect(diffPanes()).toHaveLength(1);

            h.commands.execute("vscode.diff", left, right);
            await settle(50);
            expect(diffPanes()).toHaveLength(1);

            // The side is the file's shared model: an edit from a regular tab of the same
            // resource is visible in the diff without a repeat call (live diff, US-30).
            h.commands.execute("workbench.openFile", ws.path("b.txt"));
            await settle(0);
            const editor = h.container.get(EditorServiceDIToken).getActiveEditor();
            editor?.goToPosition(1, 0);
            editor?.viewState.type("CHARLIE-");
            const pane = diffPanes()[0];
            expect(pane.sidePanes()[1].getText()).toContain("CHARLIE-BRAVO");
        });
    });
});
