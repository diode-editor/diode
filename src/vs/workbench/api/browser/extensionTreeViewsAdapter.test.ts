import { Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../TestUtils/TestApp.ts";
import { flushMicrotasks } from "../../../../TestUtils/timing.ts";
import { Uri } from "../../../base/common/uri.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import { ConfigurationRegistry } from "../../../platform/configuration/common/configurationRegistry.ts";
import { InMemoryConfigurationService } from "../../../platform/configuration/common/inMemoryConfigurationService.ts";
import type { ILogger } from "../../../platform/log/common/iLogger.ts";
import { makeViewsHarness, paneTitles, testView } from "../../browser/parts/views/viewsService.testUtils.ts";
import type { IExtensionTreeDataSource } from "../common/iExtensionTreeViewsSink.ts";
import type { IWireTreeItem } from "../common/treeViewWireTypes.ts";

import { ExtensionTreeViewsAdapter } from "./extensionTreeViewsAdapter.ts";

const VIEW = "ext.targets";

function item(handle: string, label: string, extra: Partial<IWireTreeItem> = {}): IWireTreeItem {
    return { handle, label, collapsibleState: 0, ...extra };
}

interface IRecordingSource extends IExtensionTreeDataSource {
    readonly visibility: boolean[];
    readonly requests: (string | undefined)[];
    children: Record<string, readonly IWireTreeItem[]>;
}

function source(children: Record<string, readonly IWireTreeItem[]> = { "": [item("a", "alpha")] }): IRecordingSource {
    const recorded: IRecordingSource = {
        visibility: [],
        requests: [],
        children,
        getChildren: (parent) => {
            recorded.requests.push(parent);
            return Promise.resolve(recorded.children[parent ?? ""] ?? []);
        },
        executeCommand: () => Promise.resolve(),
        setVisible: (visible) => {
            recorded.visibility.push(visible);
        },
        setExpanded: () => undefined,
        setSelection: () => undefined,
    };
    return recorded;
}

function setup(options: { colors?: Record<string, number>; folders?: readonly string[] } = {}) {
    const h = makeViewsHarness();
    h.service.registerContainer({ id: "sb", title: "SB", location: "sidebar", order: 0, isDefault: true });
    h.service.registerView(testView("sb.files", "sb", 0));
    h.service.registerView(testView(VIEW, "sb", 1, { body: null, placeholder: "nothing yet" }));
    h.service.registerContainer({ id: "other", title: "OTHER", location: "sidebar", order: 1 });
    h.service.registerView(testView("other.view", "other", 0));
    h.commands.register(`${VIEW}.focus`, () => undefined);
    h.service.attachRegisteredContainers();
    h.showViewlet("sb");
    for (const folder of options.folders ?? []) h.workspace.setWorkspaceFolder(folder);
    const warnings: string[] = [];
    const errors: string[] = [];
    const logger = { warn: (message: string) => warnings.push(message), error: () => undefined } as unknown as ILogger;
    const adapter = new ExtensionTreeViewsAdapter({
        views: h.service,
        commands: h.commands,
        menus: h.menuRegistry,
        configuration: new InMemoryConfigurationService(new ConfigurationRegistry()),
        workspace: h.workspace,
        colors: { resolve: (id) => options.colors?.[id] },
        notifyError: (message) => errors.push(message),
        logger,
    });
    const app = TestApp.createWithContent(h.root("sb"), new Size(40, 12));
    const frame = (): string => {
        app.render();
        return app.backend.screenToString();
    };
    return { h, adapter, warnings, errors, frame };
}

describe("ExtensionTreeViewsAdapter", () => {
    it("a registered tree replaces the empty section and loads, since the section is visible", async () => {
        const { adapter, frame } = setup();
        expect(frame()).toContain("nothing yet");
        const tree = source();
        adapter.register({ viewId: VIEW, showCollapseAll: false, canSelectMany: false }, tree);
        await flushMicrotasks(10);
        expect(tree.visibility).toEqual([true]);
        expect(frame()).toContain("alpha");
        expect(frame()).not.toContain("nothing yet");
    });

    it("collapsing the section or switching the container hides the tree; showing it again rereads nothing", async () => {
        const { h, adapter } = setup();
        const tree = source();
        adapter.register({ viewId: VIEW, showCollapseAll: false, canSelectMany: false }, tree);
        await flushMicrotasks(10);
        h.paneView("sb").toggleCollapsed(VIEW);
        expect(tree.visibility).toEqual([true, false]);
        h.paneView("sb").toggleCollapsed(VIEW);
        expect(tree.visibility).toEqual([true, false, true]);
        h.showViewlet("other");
        expect(tree.visibility).toEqual([true, false, true, false]);
        expect(tree.requests).toEqual([undefined]);
    });

    it("a tree registered while its section is collapsed waits to load", async () => {
        const { h, adapter } = setup();
        h.paneView("sb").toggleCollapsed(VIEW);
        const tree = source();
        adapter.register({ viewId: VIEW, showCollapseAll: false, canSelectMany: false }, tree);
        await flushMicrotasks(10);
        expect(tree.requests).toEqual([]);
        expect(tree.visibility).toEqual([]);
    });

    it("a tree for a view nobody contributed is an Output line naming the extension", () => {
        const { adapter, warnings } = setup();
        adapter.register(
            { viewId: "ghost.view", showCollapseAll: false, canSelectMany: false, extensionId: "pub.ext" },
            source(),
        );
        adapter.register({ viewId: "ghost.two", showCollapseAll: false, canSelectMany: false }, source());
        expect(warnings).toEqual([
            'tree view "ghost.view" (pub.ext): no view with this id is contributed (contributes.views), the tree is not shown',
            'tree view "ghost.two": no view with this id is contributed (contributes.views), the tree is not shown',
        ]);
    });

    it("a contributed view whose `when` is false is not warned about and gets the tree when it shows", async () => {
        const { h, adapter, warnings, frame } = setup();
        h.service.unregisterView(VIEW);
        adapter.register({ viewId: VIEW, showCollapseAll: false, canSelectMany: false }, source());
        expect(warnings).toEqual([]);
        h.service.registerView(testView(VIEW, "sb", 1, { body: null, placeholder: "nothing yet" }));
        await flushMicrotasks(10);
        expect(frame()).toContain("alpha");
    });

    it("a repeated registration rereads from the new provider", async () => {
        const { adapter, frame } = setup();
        adapter.register({ viewId: VIEW, showCollapseAll: false, canSelectMany: false }, source());
        await flushMicrotasks(10);
        const second = source({ "": [item("b", "beta")] });
        adapter.register({ viewId: VIEW, showCollapseAll: false, canSelectMany: false }, second);
        await flushMicrotasks(10);
        expect(second.visibility).toEqual([true]);
        expect(frame()).toContain("beta");
        expect(frame()).not.toContain("alpha");
    });

    it("unregister and reset take the section back to empty, with its registered title", async () => {
        const { h, adapter, frame } = setup();
        adapter.register({ viewId: VIEW, showCollapseAll: false, canSelectMany: false }, source());
        adapter.setTitle({ viewId: VIEW, title: "Mine" });
        await flushMicrotasks(10);
        adapter.unregister(VIEW);
        adapter.unregister(VIEW);
        expect(frame()).toContain("nothing yet");
        expect(paneTitles(h.paneView("sb"))).toEqual(["SB.FILES", "EXT.TARGETS"]);
        expect(adapter.getTree(VIEW)).toBeUndefined();

        adapter.register({ viewId: VIEW, showCollapseAll: false, canSelectMany: false }, source());
        adapter.reset();
        expect(frame()).toContain("nothing yet");
    });

    it("title is upper-cased like the other sections, description goes next to it", () => {
        const { h, adapter } = setup();
        adapter.setTitle({ viewId: VIEW, title: "Ignored before registration" });
        adapter.register({ viewId: VIEW, showCollapseAll: false, canSelectMany: false }, source());
        adapter.setTitle({ viewId: VIEW, title: "Providers", description: "2 found" });
        expect(paneTitles(h.paneView("sb"))).toEqual(["SB.FILES", "PROVIDERS"]);
        expect(h.paneView("sb").querySelector("#paneHeader-ext-targets")?.inspectState()).toMatchObject({
            description: "2 found",
        });
        adapter.setTitle({ viewId: VIEW });
        expect(paneTitles(h.paneView("sb"))).toEqual(["SB.FILES", "EXT.TARGETS"]);
    });

    it("refresh, message and reveal reach the registered tree only", async () => {
        const { h, adapter, frame } = setup();
        const tree = source();
        adapter.register({ viewId: VIEW, showCollapseAll: false, canSelectMany: false }, tree);
        await flushMicrotasks(10);
        adapter.setMessage(VIEW, "Hello there");
        adapter.setMessage("ghost", "nobody");
        expect(frame()).toContain("Hello there");

        tree.children[""] = [item("a", "alpha"), item("n", "newcomer")];
        await adapter.refresh(VIEW, undefined);
        await adapter.refresh("ghost", undefined);
        expect(frame()).toContain("newcomer");

        h.showViewlet("other");
        await adapter.reveal({
            viewId: VIEW,
            item: item("n", "newcomer"),
            parentChain: [],
            select: true,
            focus: false,
            expand: false,
        });
        await adapter.reveal({ viewId: "ghost", parentChain: [], select: true, focus: false, expand: false });
        expect(h.shownViewlets.at(-1)?.id).toBe("sb");
        expect(adapter.getTree(VIEW)?.treeElement.getSelectedNode()?.handle).toBe("n");
    });

    it("reveal of a tree whose view is not registered right now doesn't open anything", async () => {
        const { h, adapter } = setup();
        adapter.register({ viewId: VIEW, showCollapseAll: false, canSelectMany: false }, source());
        h.service.unregisterView(VIEW);
        const shown = h.shownViewlets.length;
        await adapter.reveal({ viewId: VIEW, parentChain: [], select: true, focus: true, expand: false });
        expect(h.shownViewlets).toHaveLength(shown);
    });

    it("showCollapseAll puts upstream's Collapse All last in the section's title, for this view only", async () => {
        const { h, adapter } = setup();
        const tree = source({
            "": [item("p", "pkg", { collapsibleState: 2 })],
            p: [item("p/c", "child")],
        });
        adapter.register({ viewId: VIEW, showCollapseAll: true, canSelectMany: false }, tree);
        await flushMicrotasks(10);
        const id = `workbench.actions.treeView.${VIEW}.collapseAll`;
        const groups = h.menuService.getEntryGroups(MenuId.ViewTitle, { view: VIEW }, { view: VIEW });
        expect(groups.flatMap((group) => group.entries).map((entry) => "id" in entry && entry.id)).toEqual([id]);
        expect(groups[0].group).toBe("navigation");
        expect(h.menuService.getEntryGroups(MenuId.ViewTitle, {}, { view: "sb.files" })).toEqual([]);
        expect(h.commands.getTitle(id)).toBe("Collapse All");

        await h.commands.execute(id);
        expect(adapter.getTree(VIEW)?.treeElement.contentHeight).toBe(1);

        adapter.unregister(VIEW);
        expect(h.commands.has(id)).toBe(false);
    });

    it("a ThemeIcon color is used only when the theme has it", async () => {
        const { adapter, frame } = setup({ colors: { "terminal.ansiRed": 0x112233 } });
        const tree = source({
            "": [
                item("a", "known", { themeIcon: { id: "package", color: "terminal.ansiRed" } }),
                item("b", "unknown", { themeIcon: { id: "package", color: "toString" } }),
            ],
        });
        adapter.register({ viewId: VIEW, showCollapseAll: false, canSelectMany: false }, tree);
        await flushMicrotasks(10);
        // An unknown token would throw while painting.
        expect(frame()).toContain("unknown");
    });

    it("`description: true` is the folder relative to the workspace folder that holds the resource", async () => {
        const { adapter, frame } = setup({ folders: ["/work/app"] });
        const tree = source({
            "": [
                item("a", "main.tf", {
                    description: true,
                    resourceUri: Uri.file("/work/app/infra/main.tf").toString(),
                }),
                item("b", "root.tf", { description: true, resourceUri: Uri.file("/work/app/root.tf").toString() }),
                item("c", "far.tf", { description: true, resourceUri: Uri.file("/elsewhere/x/far.tf").toString() }),
                item("d", "web.tf", { description: true, resourceUri: "untitled:/scratch/web.tf" }),
            ],
        });
        adapter.register({ viewId: VIEW, showCollapseAll: false, canSelectMany: false }, tree);
        await flushMicrotasks(10);
        const text = frame();
        expect(text).toContain("main.tf infra");
        expect(text).toMatch(/root\.tf\s*\n/u);
        expect(text).toContain("far.tf /elsewhere/x");
        expect(text).toContain("web.tf /scratch");
    });

    it("dispose drops every tree and stops listening", async () => {
        const { h, adapter, frame } = setup();
        const tree = source();
        adapter.register({ viewId: VIEW, showCollapseAll: false, canSelectMany: false }, tree);
        await flushMicrotasks(10);
        adapter.dispose();
        expect(frame()).toContain("nothing yet");
        h.showViewlet("other");
        expect(tree.visibility).toEqual([true]);
    });

    it("reveal with focus expands a collapsed section and shows the row, like upstream's openView", async () => {
        const { h, adapter, frame } = setup();
        const tree = source({
            "": [item("p", "pkg", { collapsibleState: 1 })],
            p: [item("p/c", "deep child", { parentHandle: "p" })],
        });
        adapter.register({ viewId: VIEW, showCollapseAll: false, canSelectMany: false }, tree);
        await flushMicrotasks(10);
        h.paneView("sb").toggleCollapsed(VIEW);
        expect(frame()).not.toContain("pkg");

        await adapter.reveal({
            viewId: VIEW,
            item: item("p/c", "deep child", { parentHandle: "p" }),
            parentChain: [item("p", "pkg", { collapsibleState: 1 })],
            select: true,
            focus: true,
            expand: false,
        });
        await flushMicrotasks(10);
        expect(tree.visibility.at(-1)).toBe(true);
        expect(frame()).toContain("deep child");
    });
});
