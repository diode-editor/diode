import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { describe, expect, it } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import type { MenuService } from "../../../../platform/actions/common/menuService.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { ProgressService } from "../../../../platform/progress/common/progressService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";

import { ChangesComponent, SCM_TOGGLE_STAGE_COMMAND } from "./changesComponent.ts";
import { PUBLISH_CHANGES_COMMAND, ScmChangesService } from "./changesService.ts";
import { ScmRepoStateService } from "./repoStateService.ts";
import { ScmInputComponent } from "./scmInputComponent.ts";

// File names whose row ids collide once characters outside [A-Za-z0-9_-] are folded (Cyrillic, "a b" / "a.b" / "a-b"):
// after a refresh the cursor must stay on the next file in display order, so Space stages them one after another.

interface IHarness {
    component: ChangesComponent;
    commands: CommandRegistry;
    /** `git.stage` / `git.unstage` calls with their uri lists, as relative paths. */
    calls: string[];
}

function make(): IHarness {
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
    for (const id of ["git.stage", "git.unstage"]) {
        commands.register(id, (uris) => {
            const rels = (uris as string[]).map((u) => Uri.parse(u).path.replace("/repo/", ""));
            calls.push(`${id.slice(4)} ${rels.join(",")}`);
            return Promise.resolve();
        });
    }
    return { component, commands, calls };
}

/** Publishes the change set: `staged` files in Staged Changes, `changed` in Changes. */
function publish(h: IHarness, staged: string[], changed: string[]): void {
    const entry = (rel: string, group: string): object => ({
        uri: Uri.file(`/repo/${rel}`).toString(),
        status: "M",
        colorId: "gitDecoration.modifiedResourceForeground",
        path: rel,
        group,
    });
    h.commands.execute(PUBLISH_CHANGES_COMMAND, [
        ...staged.map((rel) => entry(rel, "index")),
        ...changed.map((rel) => entry(rel, "worktree")),
    ]);
}

/** What git reports after the calls so far: staged files move to Staged Changes. */
function refresh(h: IHarness, names: string[]): void {
    const staged = new Set(h.calls.map((call) => call.replace(/^stage /, "")));
    publish(
        h,
        names.filter((n) => staged.has(n)),
        names.filter((n) => !staged.has(n)),
    );
}

/** Cursor on the first file under the only group header, as Home + ArrowDown do. */
function cursorOnFirstFile(h: IHarness): void {
    h.component.list.focusFirst();
    h.component.list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "ArrowDown" }));
}

function space(h: IHarness): Promise<unknown> {
    return Promise.resolve(h.commands.execute(SCM_TOGGLE_STAGE_COMMAND));
}

describe("ChangesComponent — Space toggles stage on files with non-ASCII or punctuated names", () => {
    it("Space, refresh, Space, refresh, Space on Cyrillic names stages the files in display order", async () => {
        const h = make();
        const names = ["альфа.ts", "бета.ts", "гамма.ts", "дельта.ts"];
        publish(h, [], names);
        cursorOnFirstFile(h);

        await space(h);
        refresh(h, names);
        await space(h);
        refresh(h, names);
        await space(h);

        expect(h.calls).toEqual(["stage альфа.ts", "stage бета.ts", "stage гамма.ts"]);
    });

    it("Space, refresh, Space, refresh, Space on 'a b.ts', 'a.b.ts', 'a-b.ts' stages them in display order", async () => {
        const h = make();
        const names = ["a b.ts", "a.b.ts", "a-b.ts", "c.ts"];
        publish(h, [], names);
        cursorOnFirstFile(h);

        await space(h);
        refresh(h, names);
        await space(h);
        refresh(h, names);
        await space(h);

        // Display order is localeCompare: "a b", "a-b", "a.b".
        expect(h.calls).toEqual(["stage a b.ts", "stage a-b.ts", "stage a.b.ts"]);
    });
});
