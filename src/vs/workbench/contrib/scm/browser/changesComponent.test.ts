import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { TUIContextMenuEvent, TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { describe, expect, it, vi } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IMenu, MenuService } from "../../../../platform/actions/common/menuService.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { ProgressService } from "../../../../platform/progress/common/progressService.ts";
import type { IStateDescriptor, IStateService } from "../../../../platform/state/common/iStateService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import type { WorkspaceId } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { SCM_VIEW_MODE_STATE } from "../../../common/stateKeys.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";
import { SCM_CHANGES_VIEW_ID } from "../common/scmViews.ts";

import { ChangesComponent } from "./changesComponent.ts";
import { PUBLISH_CHANGES_COMMAND, ScmChangesService } from "./changesService.ts";
import { ScmRepoStateService } from "./repoStateService.ts";
import { buildFolderRow, OPEN_FILE_BUTTON_WIDTH, OPEN_FILE_GLYPH } from "./scmChangeRows.ts";
import { ScmInputComponent } from "./scmInputComponent.ts";

const theme = WorkbenchTheme.fromThemeFile(darkPlusTheme);

type FakeMenuEntry = { label: string; onSelect?: () => void } | { type: "separator" };

function fakeMenu(entries: FakeMenuEntry[] = []): { service: MenuService; menu: IMenu } {
    const menu: IMenu = {
        getEntries: vi.fn(() =>
            entries.map((e) => ("type" in e ? { type: "separator" as const } : { type: "item" as const, ...e })),
        ),
        getSubmenus: () => [],
        onDidChange: () => ({ dispose: () => undefined }),
        dispose: () => undefined,
    };
    const service = {
        createMenu: () => menu,
        // Live resolution: assertions on `getEntries` arguments stay about the open context.
        getEntries: (_menuId: unknown, context: unknown) => menu.getEntries(context, () => null),
        getEntryGroups: () => [],
    } as unknown as MenuService;
    return { service, menu };
}

function fakeState(): { service: IStateService; stored: Map<string, unknown> } {
    const stored = new Map<string, unknown>();
    const openWorkspaceEmitter = new Emitter<WorkspaceId>();
    const service: IStateService = {
        get<T>(descriptor: IStateDescriptor<T>): T {
            return stored.has(descriptor.key) ? (stored.get(descriptor.key) as T) : descriptor.default;
        },
        store<T>(descriptor: IStateDescriptor<T>, value: T): void {
            stored.set(descriptor.key, value);
        },
        remove: () => undefined,
        openWorkspace: (workspaceId) => {
            openWorkspaceEmitter.fire(workspaceId);
        },
        flushSync: () => {},
        dispose: () => {},
        onDidOpenWorkspace: openWorkspaceEmitter.event,
    };
    return { service, stored };
}

interface IHarness {
    component: ChangesComponent;
    commands: CommandRegistry;
    scm: ScmChangesService;
    menu: IMenu;
    themeService: ThemeService;
    executed: [string, unknown[]][];
    views: { id: string; canMoveView?: boolean }[];
}

function make(opts: { state?: IStateService; menuEntries?: FakeMenuEntry[] } = {}): IHarness {
    const commands = new CommandRegistry();
    const scm = new ScmChangesService(commands);
    const { service: menuService, menu } = fakeMenu(opts.menuEntries);
    const themeService = new ThemeService(theme);
    const views: IHarness["views"] = [];
    const viewsService = {
        registerContainer: () => {},
        registerView: (descriptor: IHarness["views"][number]) => views.push(descriptor),
    } as unknown as ViewsService;
    const state = opts.state ?? NULL_STATE_SERVICE;
    const scmInput = new ScmInputComponent(
        state,
        scm,
        new ScmRepoStateService(commands, new ContextKeyService()),
        commands,
        new ProgressService(),
        new KeybindingRegistry(),
        new ContextKeyService(),
    );
    const component = new ChangesComponent(
        scm,
        commands,
        new ContextMenuService(menuService),
        state,
        viewsService,
        scmInput,
        new KeybindingRegistry(),
    );

    const executed: [string, unknown[]][] = [];
    commands.register("scm.action.openFile", (...args) => executed.push(["scm.action.openFile", args]));
    commands.register("scm.action.openChanges", (...args) => executed.push(["scm.action.openChanges", args]));

    return { component, commands, scm, menu, themeService, executed, views };
}

describe("ChangesComponent — registration", () => {
    it("the CHANGES section can be moved elsewhere", () => {
        const { views } = make();
        expect(views.find((view) => view.id === SCM_CHANGES_VIEW_ID)).toMatchObject({ canMoveView: true });
    });
});

function publish(
    commands: CommandRegistry,
    entries: { rel: string; status?: string; colorId?: string; group?: string }[],
): void {
    commands.execute(
        PUBLISH_CHANGES_COMMAND,
        entries.map((e) => ({
            uri: Uri.file(`/repo/${e.rel}`).toString(),
            status: e.status ?? "M",
            colorId: e.colorId ?? "gitDecoration.modifiedResourceForeground",
            path: e.rel,
            group: e.group ?? "worktree",
        })),
    );
}

function uriOf(rel: string): string {
    return Uri.file(`/repo/${rel}`).toString();
}

function rowIdOf(rel: string, group = "worktree"): string {
    return `scmRow-${group}-${rel.replace(/[^A-Za-z0-9_-]+/g, "-")}`;
}

/** Without the commit controls: scmInputComponent.test checks those. */
function frame(h: IHarness, w = 40, ht = 10): string {
    return renderElement(h.component.listView, w, ht, { themeVars: true }).screenToString();
}

function pressEnter(h: IHarness): void {
    h.component.list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "Enter" }));
}

describe("ChangesComponent — flat mode (default)", () => {
    it("draws paths and the status letter at the right edge; no Open File button at rest", () => {
        const h = make();
        publish(h.commands, [
            { rel: "nested/b.txt" },
            { rel: "a.txt", status: "U", colorId: "gitDecoration.untrackedResourceForeground", group: "untracked" },
        ]);

        const screen = frame(h);
        expect(screen).toContain("a.txt");
        expect(screen).toContain("nested/b.txt");
        expect(screen).toContain("U");
        // The open-file button appears only on the active row.
        expect(screen).not.toContain(OPEN_FILE_GLYPH);
        // Untracked gets no header of its own: both files are under "Changes".
        expect(screen).toContain("Changes");
        expect(screen).not.toContain("Untracked Changes");
        expect(h.component.list.rowCount).toBe(3);
    });

    it("the Open File button appears on the cursor row of a focused list", () => {
        const h = make();
        publish(h.commands, [{ rel: "a.txt" }]);
        const app = TestApp.createWithContent(h.component.view, new Size(40, 12));
        const screen = (): string => {
            app.render();
            return app.backend.screenToString();
        };

        h.component.list.setCursorTo(rowIdOf("a.txt"));
        expect(screen()).not.toContain(OPEN_FILE_GLYPH);

        h.component.focus();
        expect(screen()).toContain(OPEN_FILE_GLYPH);

        h.component.list.blur();
        expect(screen()).not.toContain(OPEN_FILE_GLYPH);
    });

    it("commit controls live in the view body above the list", () => {
        const h = make();
        TestApp.createWithContent(h.component.view, new Size(40, 12));

        const input = h.component.view.querySelector("#scmInputBox");
        expect(input).not.toBeNull();
        expect(h.component.listView.globalPosition.y).toBeGreaterThan(input!.globalPosition.y);
    });

    it("an empty set gives an empty list (the SOURCE CONTROL frame is drawn by the ViewsService container)", () => {
        const h = make();
        expect(h.component.list.rowCount).toBe(0);
        expect(frame(h).trim()).toBe("");
    });

    it("Enter on a file runs scm.action.openChanges with the uri as a string", () => {
        const h = make();
        publish(h.commands, [{ rel: "a.txt" }]);

        h.component.list.setCursorTo(rowIdOf("a.txt"));
        pressEnter(h);

        expect(h.executed).toEqual([["scm.action.openChanges", [uriOf("a.txt")]]]);
    });

    it("Enter on a group header collapses it together with its files", () => {
        const h = make();
        publish(h.commands, [{ rel: "a.txt" }]);

        h.component.list.setCursorTo("scmGroup-worktree");
        pressEnter(h);
        expect(frame(h)).not.toContain("a.txt");

        publish(h.commands, [{ rel: "a.txt" }, { rel: "b.txt" }]);
        expect(frame(h)).not.toContain("b.txt");
        expect(h.executed).toEqual([]);
    });

    it("clicking the glyph runs scm.action.openFile without moving the cursor", () => {
        const h = make();
        publish(h.commands, [{ rel: "a.txt" }, { rel: "b.txt" }]);

        const width = 30;
        const app = TestApp.createWithContent(h.component.view, new Size(width, 14));
        const list = h.component.list;
        const rowY = list.globalPosition.y + 2; // third row (group header, a.txt, b.txt)

        // The button appears on hover: without mousemove its columns are not in the row.
        list.dispatchEvent(
            new TUIMouseEvent("mousemove", {
                button: "none",
                screenX: list.globalPosition.x,
                screenY: rowY,
                localX: 0,
                localY: 2,
            }),
        );
        app.render();

        // The button occupies the columns left of the status letter (fixed 1 at the right edge).
        const buttonX = list.globalPosition.x + list.layoutSize.width - 1 - OPEN_FILE_BUTTON_WIDTH;
        list.dispatchEvent(
            new TUIMouseEvent("click", {
                button: "left",
                screenX: buttonX,
                screenY: rowY,
                localX: buttonX - list.globalPosition.x,
                localY: 2,
            }),
        );

        expect(h.executed).toEqual([["scm.action.openFile", [uriOf("b.txt")]]]);
        expect(list.getCursorElement()?.id).toBe("scmGroup-worktree");
    });

    it("getCursorChange returns the change under the cursor, and null on an empty list", () => {
        const h = make();
        expect(h.component.getCursorChange()).toBeNull();

        publish(h.commands, [{ rel: "a.txt" }]);
        h.component.list.setCursorTo(rowIdOf("a.txt"));
        expect(h.component.getCursorChange()?.path).toBe("a.txt");

        h.component.list.setCursorTo("scmGroup-worktree");
        expect(h.component.getCursorChange()).toBeNull();
    });

    it("the cursor survives publish if its row stays in the set", () => {
        const h = make();
        publish(h.commands, [{ rel: "a.txt" }, { rel: "b.txt" }]);
        h.component.list.setCursorTo(rowIdOf("b.txt"));

        publish(h.commands, [{ rel: "a.txt" }, { rel: "b.txt" }, { rel: "c.txt" }]);

        expect(h.component.list.getCursorElement()?.id).toBe(rowIdOf("b.txt"));
    });

    it("a file in two groups (MM) gives two rows with different ids", () => {
        const h = make();
        publish(h.commands, [
            { rel: "a.txt", group: "index", status: "M" },
            { rel: "a.txt", group: "worktree", status: "M" },
        ]);

        const screen = frame(h);
        expect(screen).toContain("Staged Changes");
        expect(screen).toContain("Changes");
        expect(h.component.list.rowCount).toBe(4);

        h.component.list.setCursorTo(rowIdOf("a.txt", "index"));
        expect(h.component.getCursorChange()?.group).toBe("index");
        h.component.list.setCursorTo(rowIdOf("a.txt", "worktree"));
        expect(h.component.getCursorChange()?.group).toBe("worktree");
    });

    it("an id sanitization collision (a.b ↔ a-b ↔ a_b twin) is resolved with a suffix", () => {
        const h = make();
        publish(h.commands, [{ rel: "a.b" }, { rel: "a-b" }, { rel: "a?b" }]);

        // All three rows are alive, ids are unique.
        expect(h.component.list.rowCount).toBe(4);
        h.component.list.setCursorTo("scmRow-worktree-a-b");
        expect(h.component.getCursorChange()).not.toBeNull();
        h.component.list.setCursorTo("scmRow-worktree-a-b_2");
        expect(h.component.getCursorChange()).not.toBeNull();
        h.component.list.setCursorTo("scmRow-worktree-a-b_3");
        expect(h.component.getCursorChange()).not.toBeNull();
    });

    it("a conflicted file lands in the Merge Changes group as the first section", () => {
        const h = make();
        publish(h.commands, [
            { rel: "a.txt" },
            {
                rel: "conflict.txt",
                group: "merge",
                status: "U",
                colorId: "gitDecoration.conflictingResourceForeground",
            },
        ]);

        const screen = frame(h);
        expect(screen).toContain("Merge Changes");
        expect(screen.indexOf("Merge Changes")).toBeLessThan(screen.indexOf("conflict.txt"));
        expect(screen.indexOf("conflict.txt")).toBeLessThan(screen.indexOf("a.txt"));
    });
});

describe("ChangesComponent — tree mode", () => {
    it("setViewMode('tree') groups by folders with compaction, and collapse works", () => {
        const h = make();
        // src/vs is a compact chain; src/vs/sub next to files breaks compaction below
        // and exercises recursive collection of folder files (rowMeta of folder src/vs).
        publish(h.commands, [
            { rel: "src/vs/a.ts" },
            { rel: "src/vs/b.ts" },
            { rel: "src/vs/sub/c.ts" },
            { rel: "root.txt" },
        ]);

        h.component.setViewMode("tree");
        let screen = frame(h);
        expect(screen).toContain("src/vs");
        expect(screen).toContain("a.ts");
        expect(screen).not.toContain("src/vs/a.ts");

        h.component.list.setCursorTo("scmDir-worktree-src-vs");
        pressEnter(h);
        screen = frame(h);
        expect(screen).not.toContain("a.ts");
        expect(h.executed).toEqual([]);

        expect(h.component.getCursorChange()).toBeNull();
    });

    it("opening the project store restores the mode without an external call", () => {
        const { service, stored } = fakeState();
        const h = make({ state: service });
        expect(h.component.getViewMode()).toBe("flat");
        stored.set(SCM_VIEW_MODE_STATE.key, "tree");

        service.openWorkspace("project" as WorkspaceId);

        expect(h.component.getViewMode()).toBe("tree");
    });

    it("setViewMode writes to the store, restoreViewMode reads without writing", () => {
        const { service, stored } = fakeState();
        const h = make({ state: service });
        expect(h.component.getViewMode()).toBe("flat");

        h.component.setViewMode("tree");
        expect(stored.get(SCM_VIEW_MODE_STATE.key)).toBe("tree");
        h.component.setViewMode("tree"); // repeat is a no-op

        stored.set(SCM_VIEW_MODE_STATE.key, "flat");
        const writes = vi.spyOn(service, "store");
        h.component.restoreViewMode();
        expect(h.component.getViewMode()).toBe("flat");
        expect(writes).not.toHaveBeenCalled();

        h.component.restoreViewMode(); // repeat is a no-op
        expect(h.component.getViewMode()).toBe("flat");
    });

    it("switching modes rebuilds rows from the snapshot without a new publish", () => {
        const h = make();
        publish(h.commands, [{ rel: "nested/b.txt" }]);

        h.component.setViewMode("tree");
        expect(frame(h)).not.toContain("nested/b.txt");
        h.component.setViewMode("flat");
        expect(frame(h)).toContain("nested/b.txt");
    });
});

describe("ChangesComponent — theme and context menu", () => {
    it("a theme change recolors rows in place without a rebuild (tree folders included)", () => {
        const h = make();
        publish(h.commands, [{ rel: "nested/a.txt" }]);
        h.component.setViewMode("tree"); // the folder row passes the restyle untouched
        const rowBefore = h.component.list.getChildren()[0];
        const before = frame(h);

        h.themeService.setTheme(theme); // reapplying runs the restyle over the rows

        expect(frame(h)).toBe(before);
        expect(h.component.list.getChildren()[0]).toBe(rowBefore);
    });

    it("activation and context menu of a row with an unknown id are a silent no-op (rowMeta bridge guard)", () => {
        const h = make();
        publish(h.commands, [{ rel: "a.txt" }]);

        const ghost = buildFolderRow("ghost", "ghost");
        expect(() => h.component.list.onActivate?.(ghost)).not.toThrow();
        expect(() => h.component.list.onContextMenu?.(ghost, 0, 0)).not.toThrow();
        expect(h.executed).toEqual([]);
    });

    it("getSelectedChanges: cursor on a group header gives an empty target list", () => {
        const h = make();
        publish(h.commands, [{ rel: "a.txt" }]);

        h.component.list.setCursorTo("scmGroup-worktree");
        expect(h.component.getSelectedChanges()).toEqual([]);
    });

    it("right click on a file opens the context menu, Enter picks, Escape closes", () => {
        const onSelect = vi.fn();
        // The separator checks that it passes the onSelect wrapper unchanged.
        const h = make({ menuEntries: [{ label: "Open File", onSelect }, { type: "separator" }] });
        publish(h.commands, [{ rel: "a.txt" }]);

        const app = TestApp.createWithContent(h.component.view, new Size(40, 12));

        const list = h.component.list;
        // Row 0 is the group header, file a.txt is row 1.
        const rightClick = () => {
            list.dispatchEvent(
                new TUIContextMenuEvent({
                    trigger: "mouse",
                    button: "right",
                    screenX: list.globalPosition.x + 2,
                    screenY: list.globalPosition.y + 1,
                    localX: 2,
                    localY: 1,
                }),
            );
            app.render();
        };

        rightClick();
        expect(h.menu.getEntries).toHaveBeenCalledWith(
            { kind: "resource", uris: [uriOf("a.txt")], groups: ["worktree"] },
            expect.any(Function),
        );
        expect(app.backend.screenToString()).toContain("Open File");

        // A repeated call closes the previous session and opens a new one.
        rightClick();
        expect(app.backend.screenToString()).toContain("Open File");

        // Enter picks the item: the session closes BEFORE the original onSelect.
        app.querySelector("PopupMenuElement")!.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));
        app.render();
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(app.backend.screenToString()).not.toContain("Open File");

        // Escape closes via menu.onClose → session.close() (onClose guard).
        rightClick();
        app.querySelector("PopupMenuElement")!.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Escape" }));
        app.render();
        expect(app.backend.screenToString()).not.toContain("Open File");
    });

    it("outside the app a right click is a silent no-op (no overlay layer)", () => {
        const h = make({ menuEntries: [{ label: "Open File" }] });
        publish(h.commands, [{ rel: "nested/b.txt" }]);

        const list = h.component.list;
        expect(() =>
            list.dispatchEvent(
                new TUIContextMenuEvent({
                    trigger: "mouse",
                    button: "right",
                    screenX: 2,
                    screenY: 1,
                    localX: 2,
                    localY: 1,
                }),
            ),
        ).not.toThrow();
    });

    it("the menu on a folder carries the subtree files, on a group header the whole group", () => {
        const h = make({ menuEntries: [{ label: "Stage Changes" }] });
        publish(h.commands, [{ rel: "nested/a.txt" }, { rel: "nested/b.txt" }, { rel: "root.txt" }]);
        h.component.setViewMode("tree");
        const app = TestApp.createWithContent(h.component.view, new Size(40, 12));
        const list = h.component.list;
        const rightClickRow = (row: number) => {
            list.dispatchEvent(
                new TUIContextMenuEvent({
                    trigger: "mouse",
                    button: "right",
                    screenX: list.globalPosition.x + 2,
                    screenY: list.globalPosition.y + row,
                    localX: 2,
                    localY: row,
                }),
            );
            app.render();
        };

        // Rows: Changes header (0), folder nested (1), a.txt (2), b.txt (3), root.txt (4).
        rightClickRow(1);
        expect(h.menu.getEntries).toHaveBeenLastCalledWith(
            { kind: "folder", uris: [uriOf("nested/a.txt"), uriOf("nested/b.txt")], groups: ["worktree"] },
            expect.any(Function),
        );

        rightClickRow(0);
        expect(h.menu.getEntries).toHaveBeenLastCalledWith(
            {
                kind: "group",
                uris: [uriOf("nested/a.txt"), uriOf("nested/b.txt"), uriOf("root.txt")],
                groups: ["worktree"],
            },
            expect.any(Function),
        );
    });

    it("right click on a row in a multi-select carries the whole selection, outside it a single row", () => {
        const h = make({ menuEntries: [{ label: "Stage Changes" }] });
        publish(h.commands, [{ rel: "a.txt" }, { rel: "b.txt" }, { rel: "c.txt" }]);
        const app = TestApp.createWithContent(h.component.view, new Size(40, 12));
        const list = h.component.list;

        // Select a.txt and b.txt (rows 1–2): cursor on a.txt, Shift+Down.
        list.setCursorTo(rowIdOf("a.txt"));
        list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "ArrowDown", shiftKey: true }));
        const rightClickRow = (row: number) => {
            list.dispatchEvent(
                new TUIContextMenuEvent({
                    trigger: "mouse",
                    button: "right",
                    screenX: list.globalPosition.x + 2,
                    screenY: list.globalPosition.y + row,
                    localX: 2,
                    localY: row,
                }),
            );
            app.render();
        };

        // Click on b.txt (inside the selection): context from both rows.
        rightClickRow(2);
        expect(h.menu.getEntries).toHaveBeenLastCalledWith(
            { kind: "resource", uris: [uriOf("a.txt"), uriOf("b.txt")], groups: ["worktree"] },
            expect.any(Function),
        );
        expect(h.component.getSelectedChanges().map((c) => c.path)).toEqual(["a.txt", "b.txt"]);

        // Click on c.txt (outside the selection): context from that row only.
        rightClickRow(3);
        expect(h.menu.getEntries).toHaveBeenLastCalledWith(
            { kind: "resource", uris: [uriOf("c.txt")], groups: ["worktree"] },
            expect.any(Function),
        );

        // Direct callback call for a row outside the current selection (the engine sends
        // keyboard-trigger this way): context from that row, not from the selection.
        h.component.list.setCursorTo(rowIdOf("a.txt"));
        const rowA = h.component.list.getCursorElement()!;
        h.component.list.setCursorTo(rowIdOf("b.txt"));
        h.component.list.onContextMenu?.(rowA, 5, 5);
        app.render();
        expect(h.menu.getEntries).toHaveBeenLastCalledWith(
            { kind: "resource", uris: [uriOf("a.txt")], groups: ["worktree"] },
            expect.any(Function),
        );
    });
});
