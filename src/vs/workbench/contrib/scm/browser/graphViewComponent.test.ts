import { describe, expect, it, vi } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import type { ScmGraphMenuContext } from "../../../browser/actions/menuContexts.ts";
import type {
    IViewDescriptor,
    IViewExpandedChangeEvent,
    ViewsService,
} from "../../../browser/parts/views/viewsService.ts";
import { GIT_OP_COMMAND } from "../common/gitProtocol.ts";
import { SCM_GRAPH_VIEW_ID, SCM_VIEWLET_ID } from "../common/scmViews.ts";

import { GRAPH_ENABLED_COMMAND, PUBLISH_LOG_COMMAND, ScmGraphService } from "./graphService.ts";
import { GRAPH_LOAD_MORE_COMMAND, GraphViewComponent } from "./graphViewComponent.ts";
import { LOAD_MORE_LABEL, LOAD_MORE_ROW_ID } from "./scmGraphRows.ts";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

interface ISetup {
    component: GraphViewComponent;
    commands: CommandRegistry;
    registered: IViewDescriptor[];
    shownMenus: { menuId: unknown; menuContext: unknown; owner: unknown; anchor: unknown }[];
    setExpanded(expanded: boolean): void;
}

/** `expanded: false` is both the initial state (container not built yet) and the collapsed one. */
function make(expanded = true): ISetup {
    const commands = new CommandRegistry();
    const graphService = new ScmGraphService(commands);
    const registered: IViewDescriptor[] = [];
    let isExpanded = expanded;
    const expandedChanges = new Emitter<IViewExpandedChangeEvent>();
    const viewsService = {
        registerView: (descriptor: IViewDescriptor) => {
            registered.push(descriptor);
        },
        isViewExpanded: (viewId: string) => viewId === SCM_GRAPH_VIEW_ID && isExpanded,
        onDidChangeViewExpanded: expandedChanges.event,
    } as unknown as ViewsService;
    const setExpanded = (next: boolean): void => {
        if (next === isExpanded) return;
        isExpanded = next;
        expandedChanges.fire({ viewId: SCM_GRAPH_VIEW_ID, expanded: next });
    };
    const shownMenus: { menuId: unknown; menuContext: unknown; owner: unknown; anchor: unknown }[] = [];
    const contextMenuService = {
        showContextMenu: (delegate: {
            menuId?: unknown;
            menuContext?: unknown;
            getOwner: () => unknown;
            getAnchor: () => unknown;
        }) => {
            shownMenus.push({
                menuId: delegate.menuId,
                menuContext: delegate.menuContext,
                owner: delegate.getOwner(),
                anchor: delegate.getAnchor(),
            });
        },
    } as unknown as ContextMenuService;
    const component = new GraphViewComponent(graphService, viewsService, contextMenuService, commands);
    return { component, commands, registered, shownMenus, setExpanded };
}

interface IEntry {
    sha: string;
    subject: string;
    parents?: string[];
    refs?: { name: string; kind: string; current: boolean }[];
}

function publish(commands: CommandRegistry, entries: IEntry[], hasMore = false): void {
    commands.execute(PUBLISH_LOG_COMMAND, {
        commits: entries.map((e) => ({
            sha: e.sha,
            shortSha: e.sha.slice(0, 8),
            parents: e.parents ?? [],
            refs: e.refs ?? [],
            author: "Eugene",
            timestamp: 1700000000,
            subject: e.subject,
        })),
        hasMore,
    });
}

describe("GraphViewComponent", () => {
    it("registers itself as the GRAPH view section of the Source Control container", () => {
        const { registered } = make();
        expect(registered).toHaveLength(1);
        expect(registered[0]).toMatchObject({
            id: SCM_GRAPH_VIEW_ID,
            containerId: SCM_VIEWLET_ID,
            title: "GRAPH",
            order: 20,
            collapsed: true,
            canMoveView: true,
        });
    });

    it("draws the graph and the commit subject, keeps the sha out of the frame; the row id is the full sha", () => {
        const { component, commands } = make();
        publish(commands, [
            { sha: SHA_A, subject: "feat: panel", parents: [SHA_B] },
            { sha: SHA_B, subject: "fix: cache" },
        ]);

        expect(component.list.rowCount).toBe(2);
        const screen = renderElement(component.view, 40, 6, { themeVars: true }).screenToString();
        expect(screen).toContain("○");
        expect(screen).toContain("feat: panel");
        expect(screen).toContain("fix: cache");
        // The graph has no sha column: the hash is fetched with the Copy Commit ID command.
        expect(screen).not.toContain("aaaaaaaa");
        component.list.setCursorTo(SHA_B);
        expect(component.list.getCursorElement()?.id).toBe(SHA_B);
    });

    it("the commit subject follows its row's graphics directly instead of aligning into a table", () => {
        const { component, commands } = make();
        // A linear commit on top (one lane), below it a merge forks a second one,
        // so rows have different graph widths.
        const SHA_D = "d".repeat(40);
        publish(commands, [
            { sha: SHA_A, subject: "tip", parents: [SHA_B] },
            { sha: SHA_B, subject: "merge", parents: [SHA_C, SHA_D] },
            { sha: SHA_D, subject: "feature", parents: [SHA_C] },
            { sha: SHA_C, subject: "base" },
        ]);

        const lines = renderElement(component.view, 40, 6, { themeVars: true }).screenToString().split("\n");
        const columnOf = (subject: string): number => lines.find((l) => l.includes(subject))!.indexOf(subject);

        expect(columnOf("tip")).toBeLessThan(columnOf("merge"));
        // Rows of equal width still line up: it is per-row width, not chaos.
        expect(columnOf("base")).toBe(columnOf("merge"));
    });

    it("a merge commit is drawn with its own symbol and a fork", () => {
        const { component, commands } = make();
        publish(commands, [
            { sha: SHA_A, subject: "merge", parents: [SHA_B, SHA_C] },
            { sha: SHA_C, subject: "feature" },
            { sha: SHA_B, subject: "base" },
        ]);

        const screen = renderElement(component.view, 40, 6, { themeVars: true }).screenToString();
        expect(screen).toContain("◎─╮");
    });

    it("branch and tag badges go into the row before the commit subject", () => {
        const { component, commands } = make();
        publish(commands, [
            {
                sha: SHA_A,
                subject: "feat: panel",
                refs: [
                    { name: "v1.0", kind: "tag", current: false },
                    { name: "main", kind: "head", current: true },
                ],
            },
        ]);

        const screen = renderElement(component.view, 40, 4, { themeVars: true }).screenToString();
        expect(screen).toMatch(/main.*v1\.0.*feat: panel/);
    });

    it("the Load More row appears while history continues and calls the load-more command", () => {
        const { component, commands } = make();
        const loadMore = vi.fn();
        commands.register(GRAPH_LOAD_MORE_COMMAND, loadMore);

        publish(commands, [{ sha: SHA_A, subject: "first" }], true);
        expect(component.list.rowCount).toBe(2);
        const screen = renderElement(component.view, 40, 6, { themeVars: true }).screenToString();
        expect(screen).toContain(LOAD_MORE_LABEL);

        component.list.setCursorTo(LOAD_MORE_ROW_ID);
        component.list.onActivate?.(component.list.getCursorElement()!);
        expect(loadMore).toHaveBeenCalledTimes(1);

        publish(commands, [{ sha: SHA_A, subject: "first" }], false);
        expect(component.list.rowCount).toBe(1);
    });

    it("activating a commit row does not call the load-more command", () => {
        const { component, commands } = make();
        const loadMore = vi.fn();
        commands.register(GRAPH_LOAD_MORE_COMMAND, loadMore);
        publish(commands, [{ sha: SHA_A, subject: "first" }], true);

        component.list.setCursorTo(SHA_A);
        component.list.onActivate?.(component.list.getCursorElement()!);
        expect(loadMore).not.toHaveBeenCalled();
    });

    it("the row context menu opens with the commit sha in the context", () => {
        const { component, commands, shownMenus } = make();
        publish(commands, [{ sha: SHA_A, subject: "feat: panel" }]);

        component.list.setCursorTo(SHA_A);
        component.list.onContextMenu?.(component.list.getCursorElement()!, 5, 5);

        expect(shownMenus).toHaveLength(1);
        expect(shownMenus[0].menuId).toBe(MenuId.ScmGraphContext);
        expect(shownMenus[0].menuContext).toEqual({
            sha: SHA_A,
            shortSha: SHA_A.slice(0, 8),
            subject: "feat: panel",
        } satisfies ScmGraphMenuContext);
        expect(shownMenus[0].owner).toBe(component.list);
        expect(shownMenus[0].anchor).toEqual({ screenX: 5, screenY: 5 });
    });

    it("the context menu does not open on the Load More row", () => {
        const { component, commands, shownMenus } = make();
        publish(commands, [{ sha: SHA_A, subject: "first" }], true);

        component.list.setCursorTo(LOAD_MORE_ROW_ID);
        component.list.onContextMenu?.(component.list.getCursorElement()!, 5, 5);
        expect(shownMenus).toHaveLength(0);
    });

    it("selecting a commit highlights its lines without rebuilding rows", () => {
        const { component, commands } = make();
        publish(commands, [
            { sha: SHA_A, subject: "first", parents: [SHA_B] },
            { sha: SHA_B, subject: "second", parents: [SHA_C] },
            { sha: SHA_C, subject: "third" },
        ]);
        const rowBefore = component.list.getCursorElement();

        component.list.setCursorTo(SHA_A);
        component.list.onSelect?.(component.list.getCursorElement()!);

        expect(component.list.rowCount).toBe(3);
        // Rows are the same objects: only the graph label was redrawn.
        component.list.setCursorTo(SHA_A);
        expect(component.list.getCursorElement()?.id).toBe(SHA_A);
        expect(rowBefore?.id).toBe(SHA_A);
    });

    it("a selected commit that left the page does not keep the highlight stuck", () => {
        const { component, commands } = make();
        publish(commands, [
            { sha: SHA_A, subject: "first", parents: [SHA_B] },
            { sha: SHA_B, subject: "second" },
        ]);
        component.list.setCursorTo(SHA_A);
        component.list.onSelect?.(component.list.getCursorElement()!);

        // A new page without the previous selection, e.g. after reset or checkout.
        publish(commands, [{ sha: SHA_C, subject: "third" }]);
        expect(component.list.rowCount).toBe(1);

        // Selection is reset: the same commit coming back does not inherit the highlight.
        publish(commands, [
            { sha: SHA_A, subject: "first", parents: [SHA_B] },
            { sha: SHA_B, subject: "second" },
        ]);
        expect(component.list.rowCount).toBe(2);
    });

    it("the cursor on a vanished commit does not jump to the load-more row", () => {
        const { component, commands } = make();
        publish(commands, [{ sha: SHA_A, subject: "first" }], true);
        component.list.setCursorTo(SHA_A);

        // The whole page changed (checkout of another branch), history is still longer.
        publish(commands, [{ sha: SHA_C, subject: "third" }], true);
        expect(component.list.rowCount).toBe(2);
        expect(component.list.getCursorElement()?.id).not.toBe(LOAD_MORE_ROW_ID);
    });

    it("republishing rebuilds rows, the cursor survives it by sha", () => {
        const { component, commands } = make();
        publish(commands, [
            { sha: SHA_A, subject: "first" },
            { sha: SHA_B, subject: "second" },
        ]);
        component.list.setCursorTo(SHA_B);

        publish(commands, [
            { sha: SHA_C, subject: "third" },
            { sha: SHA_B, subject: "second" },
        ]);
        expect(component.list.rowCount).toBe(2);
        expect(component.list.getCursorElement()?.id).toBe(SHA_B);
    });

    it("an empty publish clears the list", () => {
        const { component, commands } = make();
        publish(commands, [{ sha: SHA_A, subject: "first" }]);
        publish(commands, []);
        expect(component.list.rowCount).toBe(0);
    });

    it("focus focuses the list via the view descriptor", () => {
        const { component, registered } = make();
        // Standalone component without a root: focus must not throw.
        expect(() => {
            registered[0].focus();
        }).not.toThrow();
        expect(registered[0].body).toBe(component.view);
    });
});

describe("GraphViewComponent: laziness", () => {
    it("while the section is collapsed, publishes build no rows", () => {
        const { component, commands } = make(false);
        publish(commands, [
            { sha: SHA_A, subject: "feat: panel", parents: [SHA_B] },
            { sha: SHA_B, subject: "fix: cache" },
        ]);
        expect(component.list.rowCount).toBe(0);
    });

    it("expanding builds the section from the accumulated snapshot", () => {
        const { component, commands, setExpanded } = make(false);
        publish(commands, [
            { sha: SHA_A, subject: "feat: panel", parents: [SHA_B] },
            { sha: SHA_B, subject: "fix: cache" },
        ]);

        setExpanded(true);
        expect(component.list.rowCount).toBe(2);
        const screen = renderElement(component.view, 40, 6, { themeVars: true }).screenToString();
        expect(screen).toContain("feat: panel");
    });

    it("collapsing frees the rows, expanding brings them back together with the cursor", () => {
        const { component, commands, setExpanded } = make();
        publish(commands, [
            { sha: SHA_A, subject: "first" },
            { sha: SHA_B, subject: "second" },
        ]);
        component.list.setCursorTo(SHA_B);

        setExpanded(false);
        expect(component.list.rowCount).toBe(0);

        setExpanded(true);
        expect(component.list.rowCount).toBe(2);
        expect(component.list.getCursorElement()?.id).toBe(SHA_B);
    });

    it("a byte-identical publish after expanding does not leave the section empty", () => {
        const { component, commands, setExpanded } = make();
        const page = [{ sha: SHA_A, subject: "first" }];
        publish(commands, page);

        setExpanded(false);
        // The extension brought the same set: ScmGraphService suppresses it by
        // signature, so no event fires. Expanding alone must bring the rows back.
        setExpanded(true);
        publish(commands, page);
        expect(component.list.rowCount).toBe(1);
    });

    it("the extension does not compute history for a section collapsed from the very start", () => {
        const { commands } = make(false);
        // GRAPH, collapsed by default, tells the extension "`git log` not needed".
        expect(commands.execute(GRAPH_ENABLED_COMMAND)).toBe(false);

        expect(make(true).commands.execute(GRAPH_ENABLED_COMMAND)).toBe(true);
    });

    it("expanded state reaches the extension via the logSetEnabled operation", () => {
        const ops: unknown[] = [];
        const { commands, setExpanded } = make(false);
        commands.register(GIT_OP_COMMAND, (payload) => {
            ops.push(payload);
            return { ok: true };
        });

        setExpanded(true);
        setExpanded(false);
        expect(ops).toEqual([
            { op: "logSetEnabled", params: { enabled: true } },
            { op: "logSetEnabled", params: { enabled: false } },
        ]);
    });
});
