import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { describe, expect, it } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { MenuService } from "../../../../platform/actions/common/menuService.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { ProgressService } from "../../../../platform/progress/common/progressService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { SCM_CHANGES_VIEW_ID, SCM_GRAPH_VIEW_ID } from "../common/scmViews.ts";

import { ChangesComponent, SCM_TOGGLE_STAGE_COMMAND } from "./changesComponent.ts";
import { PUBLISH_CHANGES_COMMAND, ScmChangesService } from "./changesService.ts";
import { ScmRepoStateService } from "./repoStateService.ts";
import { ScmInputComponent } from "./scmInputComponent.ts";

interface IHarness {
    component: ChangesComponent;
    commands: CommandRegistry;
    keybindings: KeybindingRegistry;
    /** `git.stage` / `git.unstage` calls with their uri lists, as relative paths. */
    calls: string[];
    /** Settles the running stage/unstage, as the extension's mutation reply does. */
    settle: () => Promise<void>;
}

function make(opts: { hold?: boolean } = {}): IHarness {
    const commands = new CommandRegistry();
    const scm = new ScmChangesService(commands);
    const keybindings = new KeybindingRegistry();
    const viewsService = { registerContainer: () => {}, registerView: () => {} } as unknown as ViewsService;
    const scmInput = new ScmInputComponent(
        NULL_STATE_SERVICE,
        scm,
        new ScmRepoStateService(commands, new ContextKeyService()),
        commands,
        new ProgressService(),
        keybindings,
        new ContextKeyService(),
    );
    const component = new ChangesComponent(
        scm,
        commands,
        new ContextMenuService({} as MenuService),
        NULL_STATE_SERVICE,
        viewsService,
        scmInput,
        keybindings,
    );

    const calls: string[] = [];
    let pending: (() => void) | null = null;
    for (const id of ["git.stage", "git.unstage"]) {
        commands.register(id, (uris) => {
            const rels = (uris as string[]).map((u) => Uri.parse(u).path.replace("/repo/", ""));
            // As `gitMutating` does: the command is disabled while a git operation runs.
            if (pending !== null) {
                calls.push(`dropped ${rels.join(",")}`);
                return undefined;
            }
            calls.push(`${id.slice(4)} ${rels.join(",")}`);
            if (opts.hold !== true) return Promise.resolve();
            return new Promise<void>((resolve) => {
                pending = () => {
                    pending = null;
                    resolve();
                };
            });
        });
    }
    const settle = async (): Promise<void> => {
        pending?.();
        await new Promise((resolve) => setImmediate(resolve));
    };
    return { component, commands, keybindings, calls, settle };
}

interface Entry {
    rel: string;
    group?: string;
}

function publish(h: IHarness, entries: Entry[]): void {
    h.commands.execute(
        PUBLISH_CHANGES_COMMAND,
        entries.map((e) => ({
            uri: Uri.file(`/repo/${e.rel}`).toString(),
            status: e.group === "untracked" ? "U" : "M",
            colorId: "gitDecoration.modifiedResourceForeground",
            path: e.rel,
            group: e.group ?? "worktree",
        })),
    );
}

function rowIdOf(rel: string, group = "worktree"): string {
    return `scmRow-${group}-${rel.replace(/[^A-Za-z0-9_-]+/g, "-")}`;
}

function cursor(h: IHarness): string | undefined {
    return h.component.list.getCursorElement()?.id;
}

function space(h: IHarness): Promise<unknown> {
    return Promise.resolve(h.commands.execute(SCM_TOGGLE_STAGE_COMMAND));
}

function frame(h: IHarness): string {
    return renderElement(h.component.listView, 30, 10, { themeVars: true }).screenToString();
}

function files(...rels: string[]): Entry[] {
    return rels.map((rel) => ({ rel }));
}

const STAGED = (rel: string): Entry => ({ rel, group: "index" });

describe("ChangesComponent — Space toggles stage", () => {
    it("Space three times in Changes stages three files one by one, the cursor ends on the fourth", async () => {
        const h = make();
        publish(h, files("a.txt", "b.txt", "c.txt", "d.txt"));
        h.component.list.setCursorTo(rowIdOf("a.txt"));

        await space(h);
        expect(cursor(h)).toBe(rowIdOf("b.txt"));
        publish(h, [STAGED("a.txt"), ...files("b.txt", "c.txt", "d.txt")]);
        await space(h);
        publish(h, [STAGED("a.txt"), STAGED("b.txt"), ...files("c.txt", "d.txt")]);
        await space(h);
        publish(h, [STAGED("a.txt"), STAGED("b.txt"), STAGED("c.txt"), ...files("d.txt")]);
        await h.settle();

        expect(h.calls).toEqual(["stage a.txt", "stage b.txt", "stage c.txt"]);
        expect(cursor(h)).toBe(rowIdOf("d.txt"));
        const screen = frame(h).split("\n");
        expect(screen[0]).toMatch(/Staged Changes\s+3/);
        expect(screen[4]).toMatch(/Changes\s+1/);
    });

    it("Space on a file in Staged Changes unstages it", async () => {
        const h = make();
        publish(h, [STAGED("a.txt"), STAGED("b.txt"), ...files("c.txt")]);
        h.component.list.setCursorTo(rowIdOf("a.txt", "index"));

        await space(h);

        expect(h.calls).toEqual(["unstage a.txt"]);
        expect(cursor(h)).toBe(rowIdOf("b.txt", "index"));
    });

    it("Merge Changes and untracked files are staged; untracked is in the Changes group for navigation", async () => {
        const h = make();
        publish(h, [{ rel: "m.txt", group: "merge" }, { rel: "a.txt" }, { rel: "u.txt", group: "untracked" }]);
        h.component.list.setCursorTo(rowIdOf("m.txt", "merge"));
        await space(h);
        expect(h.calls).toEqual(["stage m.txt"]);

        h.component.list.setCursorTo(rowIdOf("a.txt"));
        await space(h);
        expect(cursor(h)).toBe(rowIdOf("u.txt", "untracked"));
        await space(h);
        expect(h.calls).toEqual(["stage m.txt", "stage a.txt", "stage u.txt"]);
    });

    it("on the last file of a group the cursor goes to the previous file of that group", async () => {
        const h = make();
        publish(h, [STAGED("s.txt"), ...files("a.txt", "b.txt")]);
        h.component.list.setCursorTo(rowIdOf("b.txt"));

        await space(h);

        expect(cursor(h)).toBe(rowIdOf("a.txt"));
    });

    it("the only file of a group: after refresh the cursor is on the nearest remaining row, not lost", async () => {
        const h = make();
        publish(h, [STAGED("s.txt"), ...files("a.txt")]);
        h.component.list.setCursorTo(rowIdOf("a.txt"));

        await space(h);
        expect(cursor(h)).toBe(rowIdOf("a.txt"));
        publish(h, [STAGED("a.txt"), STAGED("s.txt")]);

        // Rows were [Staged, s, Changes, a] → [Staged, a, s]: index 3 clamps to the last row.
        expect(cursor(h)).toBe(rowIdOf("s.txt", "index"));
        await space(h);
        expect(h.calls).toEqual(["stage a.txt", "unstage s.txt"]);
    });

    it("a lost cursor row in the middle keeps the cursor at the same position", async () => {
        const h = make();
        publish(h, files("a.txt", "b.txt", "c.txt"));
        h.component.list.setCursorTo(rowIdOf("b.txt"));

        publish(h, files("a.txt", "c.txt"));

        expect(cursor(h)).toBe(rowIdOf("c.txt"));
    });

    it("rapid Space before any refresh acts on the next file each time, never twice on the same one", async () => {
        const h = make({ hold: true });
        publish(h, files("a.txt", "b.txt", "c.txt", "d.txt", "e.txt"));
        h.component.list.setCursorTo(rowIdOf("a.txt"));

        for (let i = 0; i < 5; i++) void space(h);

        // The cursor is already past every pressed file; e.txt is the last one and the rest are
        // still in flight, so it stays.
        expect(cursor(h)).toBe(rowIdOf("e.txt"));
        // Each press waits for the previous one: a call made while git is busy would be dropped.
        await new Promise((resolve) => setImmediate(resolve));
        expect(h.calls).toEqual(["stage a.txt"]);
        for (let i = 0; i < 5; i++) await h.settle();
        expect(h.calls).toEqual(["stage a.txt", "stage b.txt", "stage c.txt", "stage d.txt", "stage e.txt"]);

        // Once the operations settle, those rows are ordinary again.
        h.component.list.setCursorTo(rowIdOf("e.txt"));
        void space(h);
        expect(cursor(h)).toBe(rowIdOf("d.txt"));
    });

    it("a failed git call still frees the row for navigation", async () => {
        const h = make();
        h.commands.register("git.stage", () => Promise.reject(new Error("index.lock")));
        publish(h, files("a.txt", "b.txt"));
        h.component.list.setCursorTo(rowIdOf("a.txt"));

        await space(h);
        await h.settle();
        expect(cursor(h)).toBe(rowIdOf("b.txt"));

        await space(h);
        expect(cursor(h)).toBe(rowIdOf("a.txt"));
    });

    it("a selection containing the cursor is staged as a whole; next is counted from its last row", async () => {
        const h = make();
        publish(h, files("a.txt", "b.txt", "c.txt", "d.txt"));
        const list = h.component.list;
        list.setCursorTo(rowIdOf("a.txt"));
        list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "ArrowDown", shiftKey: true }));
        list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "ArrowDown", shiftKey: true }));
        list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "ArrowUp", shiftKey: true }));

        await space(h);

        expect(h.calls).toEqual(["stage a.txt,b.txt"]);
        expect(cursor(h)).toBe(rowIdOf("c.txt"));
    });

    it("the cursor row's group picks the direction: a mixed selection in Staged unstages only Staged files", async () => {
        const h = make();
        publish(h, [STAGED("s1.txt"), STAGED("s2.txt"), ...files("w1.txt", "w2.txt")]);
        const list = h.component.list;
        // Rows: Staged, s1, s2, Changes, w1, w2. Select w1 → s2 upward, cursor on s2.
        list.setCursorTo(rowIdOf("w1.txt"));
        list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "ArrowUp", shiftKey: true }));
        list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "ArrowUp", shiftKey: true }));

        await space(h);

        expect(h.calls).toEqual(["unstage s2.txt"]);
        expect(cursor(h)).toBe(rowIdOf("s1.txt", "index"));
    });

    it("a cursor outside the selection acts on its own row only", async () => {
        const h = make();
        publish(h, files("a.txt", "b.txt", "c.txt"));
        const list = h.component.list;
        renderElement(h.component.listView, 30, 10, { themeVars: true });
        const ctrlClick = (row: number): void => {
            list.dispatchEvent(
                new TUIMouseEvent("click", {
                    button: "left",
                    ctrlKey: true,
                    screenX: 0,
                    screenY: 0,
                    localX: 2,
                    localY: row,
                }),
            );
        };
        list.setCursorTo(rowIdOf("a.txt"));
        ctrlClick(3); // selection {a, c}, cursor on c
        ctrlClick(3); // c leaves the selection, the cursor stays on it

        await space(h);

        expect(h.calls).toEqual(["stage c.txt"]);
    });

    it("an MM file: Space in Changes stages it, in Staged unstages; the cursor stays in the pressed group", async () => {
        const h = make();
        publish(h, [STAGED("m.txt"), STAGED("s.txt"), ...files("m.txt", "w.txt")]);

        h.component.list.setCursorTo(rowIdOf("m.txt"));
        await space(h);
        expect(cursor(h)).toBe(rowIdOf("w.txt"));

        h.component.list.setCursorTo(rowIdOf("m.txt", "index"));
        await space(h);
        expect(cursor(h)).toBe(rowIdOf("s.txt", "index"));

        expect(h.calls).toEqual(["stage m.txt", "unstage m.txt"]);
    });

    it("Space on a group header or a folder collapses it and stages nothing", async () => {
        const h = make();
        publish(h, files("src/a.ts", "src/b.ts", "root.txt"));
        h.component.setViewMode("tree");

        h.component.list.setCursorTo("scmDir-worktree-src");
        await space(h);
        expect(frame(h)).not.toContain("a.ts");
        h.component.list.setCursorTo("scmGroup-worktree");
        await space(h);
        expect(frame(h)).not.toContain("root.txt");
        await space(h);
        expect(frame(h)).toContain("root.txt");

        expect(h.calls).toEqual([]);
    });

    it("tree mode: next is the next file leaf in tree order, folders are skipped, collapsed ones too", async () => {
        const h = make();
        publish(h, files("x/a.ts", "y/b.ts", "y/c.ts", "z/d.ts", "root.txt"));
        h.component.setViewMode("tree");

        h.component.list.setCursorTo(rowIdOf("x/a.ts"));
        await space(h);
        expect(cursor(h)).toBe(rowIdOf("y/b.ts"));

        h.component.list.setCursorTo("scmDir-worktree-z");
        await space(h); // collapse z
        h.component.list.setCursorTo(rowIdOf("y/c.ts"));
        await space(h);
        expect(cursor(h)).toBe(rowIdOf("root.txt"));
        expect(h.calls).toEqual(["stage x/a.ts", "stage y/c.ts"]);
    });

    it("an empty list and a cursor-less list are a silent no-op", async () => {
        const h = make();
        await space(h);
        publish(h, files("a.txt"));
        h.component.list.clearCursor();
        await space(h);
        expect(h.calls).toEqual([]);
    });

    it("a git.stage that returns nothing (inactive git extension) settles quietly", async () => {
        const h = make();
        publish(h, files("a.txt", "b.txt"));
        h.commands.register("git.stage", () => undefined);
        h.component.list.setCursorTo(rowIdOf("a.txt"));
        await expect(space(h)).resolves.toBeUndefined();
        await space(h);
        expect(cursor(h)).toBe(rowIdOf("a.txt"));
    });
});

describe("ChangesComponent — the Space keybinding", () => {
    const SPACE = { key: " ", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };

    function resolve(h: IHarness, focusedView: string, listFocus: boolean): unknown {
        const ctx = new ContextKeyService();
        ctx.set("focusedView", focusedView);
        ctx.set("listFocus", listFocus);
        return h.keybindings.resolveKey(SPACE, ctx);
    }

    it("is bound only in the focused CHANGES list", async () => {
        const h = make();
        expect(resolve(h, SCM_CHANGES_VIEW_ID, true)).toMatchObject({
            kind: "command",
            commandId: SCM_TOGGLE_STAGE_COMMAND,
        });
        // The commit input lives in the same section, but it is not a list: Space types a space there.
        expect(resolve(h, SCM_CHANGES_VIEW_ID, false)).toMatchObject({ kind: "none" });
        expect(resolve(h, SCM_GRAPH_VIEW_ID, true)).toMatchObject({ kind: "none" });
        expect(resolve(h, "workbench.explorer.fileView", true)).toMatchObject({ kind: "none" });
    });

    it("has no palette title", async () => {
        const h = make();
        expect(h.commands.has(SCM_TOGGLE_STAGE_COMMAND)).toBe(true);
        expect(h.commands.getTitle(SCM_TOGGLE_STAGE_COMMAND)).toBeUndefined();
    });
});
