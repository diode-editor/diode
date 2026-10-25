import * as fs from "node:fs";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { settle } from "../../../TestUtils/timing.ts";
import { Emitter } from "../../base/common/event.ts";
import { Uri } from "../../base/common/uri.ts";
import { createTestContainer } from "../../diode/modules/testProfile.ts";
import { CommandRegistry, CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { FileSystemProviderCapabilities, IFileServiceDIToken } from "../../platform/files/common/files.ts";
import type { ChangesComponent } from "../contrib/scm/browser/changesComponent.ts";
import { ChangesComponentDIToken } from "../contrib/scm/browser/changesComponent.ts";
import { PUBLISH_CHANGES_COMMAND } from "../contrib/scm/browser/changesService.ts";
import { ORIGINAL_RESOURCE_COMMAND } from "../contrib/scm/browser/commandOriginalResourceProvider.ts";
import type { IEditorService } from "../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";
import { ThemeServiceDIToken } from "../services/themes/common/themeTokens.ts";

import { DiffEditorPane2 } from "./parts/editor/diffEditorPane2.ts";
import type { SidebarService } from "./parts/sidebar/sidebarService.ts";
import { SidebarServiceDIToken } from "./parts/sidebar/sidebarService.ts";
import { WorkbenchComponent, WorkbenchComponentDIToken } from "./workbenchComponent.ts";

/**
 * Stubs play git (a `git:` provider + `originalResource`); the core path is real. A git uri carries
 * the ref like the extension: `HEAD`, or `` for the index (requested as `~`).
 */

const AT_HEAD = "alpha\nbravo\ncharlie\ndelta\n";
const SHOW_SCM = "workbench.view.scm";
const SHOW_EXPLORER = "workbench.view.explorer";
const MODIFIED = "gitDecoration.modifiedResourceForeground";
const UNTRACKED = "gitDecoration.untrackedResourceForeground";
const ADDED = "gitDecoration.addedResourceForeground";
const DELETED = "gitDecoration.deletedResourceForeground";

describe("Workbench — Source Control in the sidebar end-to-end", () => {
    let ws: ITempWorkspace;
    let workbench: WorkbenchComponent;
    let commands: CommandRegistry;
    let editors: IEditorService;
    let changes: ChangesComponent;
    let sidebar: SidebarService;
    let sideBg: number;
    let testApp: TestApp;
    /** Index content by fsPath; absent means "same as HEAD", `null` means "not in the index". */
    let index: Map<string, string | null>;
    /** HEAD content by fsPath; absent means {@link AT_HEAD}, `null` means "not in HEAD". */
    let head: Map<string, string | null>;
    let gitChanges: Emitter<readonly Uri[]>;
    let servedGitUris: Uri[];

    function publish(entries: { path: string; rel: string; status: string; colorId: string; group?: string }[]): void {
        commands.execute(
            PUBLISH_CHANGES_COMMAND,
            entries.map((e) => ({
                uri: Uri.file(e.path).toString(),
                status: e.status,
                colorId: e.colorId,
                path: e.rel,
                group: e.group ?? "worktree",
            })),
        );
    }

    function activate(rel: string, group = "worktree"): void {
        changes.list.setCursorTo(`scmRow-${group}-${rel.replace(/[^A-Za-z0-9_-]+/g, "-")}`);
        changes.list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "Enter" }));
    }

    /**
     * Opening a diff reads the disk asynchronously — a fixed sleep flakes on CI under
     * coverage. On timeout it returns the last frame so the assert fails with a diff.
     */
    async function waitForScreen(predicate: (screen: string) => boolean, timeoutMs = 5000): Promise<string> {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            testApp.render();
            const screen = testApp.backend.screenToString();
            if (predicate(screen) || Date.now() > deadline) return screen;
            await settle(10);
        }
    }

    beforeEach(async () => {
        ws = createTempWorkspace({
            prefix: "diode-changes-",
            files: { "a.txt": AT_HEAD, "nested/b.txt": "b-on-disk\n", "untracked.txt": "brand new\n" },
        });

        index = new Map();
        head = new Map();
        gitChanges = new Emitter();
        servedGitUris = [];
        const { container, bindApp } = createTestContainer();
        // The built-in registry already knows file: (markersModule); git: is added the way an extension
        // adapter does. For an untracked file originalResource returns null, like the git extension.
        container.get(IFileServiceDIToken).registerProvider("git", {
            capabilities: FileSystemProviderCapabilities.Readonly,
            readFile: (uri) => {
                servedGitUris.push(uri);
                const { ref } = JSON.parse(uri.query) as { ref: string };
                const text = ref === "" && index.has(uri.path) ? index.get(uri.path) : (head.get(uri.path) ?? AT_HEAD);
                if (text === null || (ref === "HEAD" && head.get(uri.path) === null)) {
                    return Promise.reject(new Error("not at this revision"));
                }
                return Promise.resolve(new TextEncoder().encode(text));
            },
            onDidChangeFile: gitChanges.event,
        });

        workbench = container.get(WorkbenchComponentDIToken);
        commands = container.get(CommandRegistryDIToken);
        editors = container.get(EditorServiceDIToken);
        changes = container.get(ChangesComponentDIToken);
        sidebar = container.get(SidebarServiceDIToken);
        sideBg = container.get(ThemeServiceDIToken).theme.getRequiredColor("sideBar.background");
        commands.register(ORIGINAL_RESOURCE_COMMAND, (raw, ref) =>
            String(raw).endsWith("untracked.txt")
                ? null
                : Uri.from({
                      scheme: "git",
                      path: Uri.parse(String(raw)).fsPath,
                      query: JSON.stringify({ ref: ref === "~" ? "" : (ref ?? "HEAD") }),
                  }).toString(),
        );

        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        // 26 rows: the Source Control section gives its top 5 rows to the commit controls, and
        // with 20 rows the list wouldn't fit the whole set.
        testApp = TestApp.create(workbench.view, new Size(150, 26));
        bindApp(testApp.app);

        commands.execute("workbench.openFile", ws.path("a.txt"));
        await settle(0);
    });

    afterEach(() => {
        workbench.dispose();
        gitChanges.dispose();
        ws.dispose();
    });

    function diffPanes(): DiffEditorPane2[] {
        return editors.editorGroups.activeGroup.getPanes().filter((p) => p instanceof DiffEditorPane2);
    }

    it("the sidebar shows Explorer by default", () => {
        testApp.render();
        expect(sidebar.getActiveViewletId()).toBe("explorer");
        expect(testApp.backend.screenToString()).toContain("EXPLORER");
    });

    it("workbench.view.scm shows the list of changed files in the sidebar", async () => {
        publish([
            { path: ws.path("a.txt"), rel: "a.txt", status: "M", colorId: MODIFIED },
            { path: ws.path("nested/b.txt"), rel: "nested/b.txt", status: "U", colorId: UNTRACKED, group: "untracked" },
        ]);
        commands.execute(SHOW_SCM);
        await settle(0);
        testApp.render();

        const screen = testApp.backend.screenToString();
        expect(sidebar.getActiveViewletId()).toBe("scm");
        expect(screen).toContain("SOURCE CONTROL");
        expect(screen).toContain("nested/b.txt");
        expect(changes.list.resolvedStyle.bg).toBe(sideBg);
    });

    it("switching Explorer ↔ Source Control changes the sidebar content", () => {
        commands.execute(SHOW_SCM);
        testApp.render();
        let screen = testApp.backend.screenToString();
        expect(screen).toContain("SOURCE CONTROL");
        expect(screen).not.toContain("EXPLORER");

        commands.execute(SHOW_EXPLORER);
        testApp.render();
        screen = testApp.backend.screenToString();
        expect(sidebar.getActiveViewletId()).toBe("explorer");
        expect(screen).toContain("EXPLORER");
        expect(screen).not.toContain("SOURCE CONTROL");
    });

    it("activating an open file shows a diff with unsaved edits in a single tab", async () => {
        const editor = editors.getActiveEditor();
        editor?.goToPosition(1, 0);
        editor?.viewState.type("XX");

        publish([{ path: ws.path("a.txt"), rel: "a.txt", status: "M", colorId: MODIFIED }]);
        commands.execute(SHOW_SCM);
        await settle(0);

        const panesBefore = editors.editorGroups.activeGroup.editorCount;
        activate("a.txt");

        const screen = await waitForScreen((s) => s.includes("a.txt (Working Tree)"));
        expect(screen).toContain("a.txt (Working Tree)");
        expect(screen).toMatch(/2-\s+bravo/u);
        expect(screen).toMatch(/2\+\s+XXbravo/u);
        expect(editors.editorGroups.activeGroup.editorCount).toBe(panesBefore + 1);
    });

    it("activating a file that is NOT open reads the disk and opens only the diff tab", async () => {
        publish([{ path: ws.path("nested/b.txt"), rel: "nested/b.txt", status: "M", colorId: MODIFIED }]);
        commands.execute(SHOW_SCM);
        await settle(0);

        activate("nested/b.txt");

        expect(await waitForScreen((s) => s.includes("b.txt (Working Tree)"))).toContain("b.txt (Working Tree)");
        // fsPath doesn't throw on non-file schemes (the diff carries the same path) — the file
        // tab is told apart by its scheme.
        const panes = editors.editorGroups.activeGroup.getPanes();
        expect(panes.filter((p) => p.uri.scheme === "diode-diff")).toHaveLength(1);
        expect(panes.some((p) => p.uri.scheme === "file" && p.uri.fsPath === ws.path("nested/b.txt"))).toBe(false);
    });

    it("activating an untracked file opens the file itself, not a notice", async () => {
        publish([
            {
                path: ws.path("untracked.txt"),
                rel: "untracked.txt",
                status: "U",
                colorId: UNTRACKED,
                group: "untracked",
            },
        ]);
        commands.execute(SHOW_SCM);
        await settle(0);

        activate("untracked.txt", "untracked");

        const screen = await waitForScreen((s) => s.includes("brand new"));
        expect(screen).toContain("brand new");
        expect(screen).not.toContain("(Working Tree)");
        expect(screen).not.toContain("No changes to compare");
        expect(editors.editorGroups.activeGroup.getPanes().some((p) => p.uri.fsPath === ws.path("untracked.txt"))).toBe(
            true,
        );
    });

    it("scm.action.viewAsTree groups by folder, viewAsList restores the paths", async () => {
        publish([
            { path: ws.path("a.txt"), rel: "a.txt", status: "M", colorId: MODIFIED },
            { path: ws.path("nested/b.txt"), rel: "nested/b.txt", status: "M", colorId: MODIFIED },
        ]);
        commands.execute(SHOW_SCM);
        await settle(0);

        commands.execute("scm.action.viewAsTree");
        testApp.render();
        let screen = testApp.backend.screenToString();
        expect(screen).toContain("nested");
        expect(screen).not.toContain("nested/b.txt");

        commands.execute("scm.action.viewAsList");
        testApp.render();
        screen = testApp.backend.screenToString();
        expect(screen).toContain("nested/b.txt");
    });
    describe("Open Changes compares by the row's group, as in VS Code", () => {
        /** a.txt: `bravo` → `BRAVO` staged, then `delta` → `DELTA` in the working tree (MM). */
        function stageThenEditAgain(): void {
            index.set(ws.path("a.txt"), "alpha\nBRAVO\ncharlie\ndelta\n");
            ws.writeFile("a.txt", "alpha\nBRAVO\ncharlie\nDELTA\n");
            publish([
                { path: ws.path("a.txt"), rel: "a.txt", status: "M", colorId: MODIFIED, group: "index" },
                { path: ws.path("a.txt"), rel: "a.txt", status: "M", colorId: MODIFIED, group: "worktree" },
            ]);
        }

        beforeEach(async () => {
            // The file is not open: its diff side is read from disk.
            commands.execute("workbench.action.closeAllEditors");
            await settle(0);
        });

        it("the Changes row diffs the index with the working tree: only the second edit", async () => {
            stageThenEditAgain();
            commands.execute(SHOW_SCM);
            await settle(0);

            activate("a.txt", "worktree");

            const screen = await waitForScreen((s) => s.includes("a.txt (Working Tree)"));
            expect(screen).toContain("a.txt (Working Tree)");
            expect(screen).toMatch(/4-\s+delta/u);
            expect(screen).toMatch(/4\+\s+DELTA/u);
            expect(screen).not.toMatch(/2-\s+bravo/u);
        });

        it("the Staged row diffs HEAD with the index: only the first edit, read-only on the right", async () => {
            stageThenEditAgain();
            commands.execute(SHOW_SCM);
            await settle(0);

            activate("a.txt", "index");

            const screen = await waitForScreen((s) => s.includes("a.txt (Index)"));
            expect(screen).toContain("a.txt (Index)");
            expect(screen).toMatch(/2-\s+bravo/u);
            expect(screen).toMatch(/2\+\s+BRAVO/u);
            expect(screen).not.toContain("DELTA");
            const [pane] = diffPanes();
            expect(pane.sidePanes().map((side) => side.readOnly)).toEqual([true, true]);
            expect(pane.revertHunkAtCaret()).toBe("read-only");
        });

        it("the two rows of an MM file open two different tabs", async () => {
            stageThenEditAgain();
            commands.execute(SHOW_SCM);
            await settle(0);

            activate("a.txt", "worktree");
            await waitForScreen((s) => s.includes("a.txt (Working Tree)"));
            activate("a.txt", "index");
            await waitForScreen((s) => s.includes("a.txt (Index)"));

            expect(diffPanes().map((p) => p.label)).toEqual(["a.txt (Working Tree)", "a.txt (Index)"]);
            // Activating the first row again returns to its tab instead of opening a third one.
            activate("a.txt", "worktree");
            await settle(10);
            expect(diffPanes()).toHaveLength(2);
            expect(editors.editorGroups.activeGroup.activePane?.label).toBe("a.txt (Working Tree)");
        });

        it("the open Staged diff follows the index when it changes", async () => {
            stageThenEditAgain();
            commands.execute(SHOW_SCM);
            await settle(0);
            activate("a.txt", "index");
            await waitForScreen((s) => /2\+\s+BRAVO/u.test(s));

            index.set(ws.path("a.txt"), "alpha\nBRAVO\nCHARLIE\ndelta\n");
            gitChanges.fire(servedGitUris);

            const screen = await waitForScreen((s) => /3\+\s+CHARLIE/u.test(s));
            expect(screen).toMatch(/3\+\s+CHARLIE/u);
            expect(diffPanes()).toHaveLength(1);
        });

        it("a file added to the index: empty on the left, the index on the right", async () => {
            head.set(ws.path("added.txt"), null);
            index.set(ws.path("added.txt"), "staged new\n");
            publish([{ path: ws.path("added.txt"), rel: "added.txt", status: "A", colorId: ADDED, group: "index" }]);
            commands.execute(SHOW_SCM);
            await settle(0);

            activate("added.txt", "index");

            const screen = await waitForScreen((s) => s.includes("added.txt (Index)"));
            expect(screen).toMatch(/1\+\s+staged new/u);
            // The left (HEAD) column is empty up to the side separator.
            expect(screen).toMatch(/1- +│/u);
        });

        it("a file deleted in the working tree: the index on the left, empty on the right", async () => {
            index.set(ws.path("nested/b.txt"), "b-in-index\n");
            fs.rmSync(ws.path("nested/b.txt"));
            publish([{ path: ws.path("nested/b.txt"), rel: "nested/b.txt", status: "D", colorId: DELETED }]);
            commands.execute(SHOW_SCM);
            await settle(0);

            activate("nested/b.txt", "worktree");

            const screen = await waitForScreen((s) => s.includes("b.txt (Deleted)"));
            expect(screen).toMatch(/1-\s+b-in-index/u);
        });

        it("a file deleted in the index: HEAD on the left, empty on the right", async () => {
            index.set(ws.path("nested/b.txt"), null);
            head.set(ws.path("nested/b.txt"), "b-at-head\n");
            fs.rmSync(ws.path("nested/b.txt"));
            publish([
                { path: ws.path("nested/b.txt"), rel: "nested/b.txt", status: "D", colorId: DELETED, group: "index" },
            ]);
            commands.execute(SHOW_SCM);
            await settle(0);

            activate("nested/b.txt", "index");

            const screen = await waitForScreen((s) => s.includes("b.txt (Deleted)"));
            expect(screen).toMatch(/1-\s+b-at-head/u);
        });

        it("a conflicted file opens as itself", async () => {
            publish([{ path: ws.path("a.txt"), rel: "a.txt", status: "U", colorId: MODIFIED, group: "merge" }]);
            commands.execute(SHOW_SCM);
            await settle(0);

            activate("a.txt", "merge");

            await waitForScreen((s) => s.includes("charlie"));
            expect(diffPanes()).toHaveLength(0);
            expect(editors.getActiveEditor()?.uri.fsPath).toBe(ws.path("a.txt"));
        });

        it("from the palette, without an argument, it takes the cursor row with its group", async () => {
            stageThenEditAgain();
            commands.execute(SHOW_SCM);
            await settle(0);
            changes.list.setCursorTo("scmRow-index-a-txt");

            commands.execute("scm.action.openChanges");

            expect(await waitForScreen((s) => s.includes("a.txt (Index)"))).toContain("a.txt (Index)");
        });

        it("a uri outside the change set is still compared with HEAD", async () => {
            publish([]);
            commands.execute(SHOW_SCM);
            await settle(0);

            commands.execute("scm.action.openChanges", Uri.file(ws.path("a.txt")).toString());

            expect(await waitForScreen((s) => s.includes("a.txt ↔ HEAD"))).toContain("a.txt ↔ HEAD");
        });
    });
});
