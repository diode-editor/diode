import { Size } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import type { MenuEntry } from "@tuidom/elements/menu/popupMenuElement";
import { PopupMenuElement } from "@tuidom/elements/menu/popupMenuElement";
import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../../TestUtils/TestApp.ts";
import { flushMicrotasks } from "../../../../TestUtils/timing.ts";
import { CODICON_GLYPHS } from "../../../base/common/codicons.generated.ts";
import { ConfigurationRegistry } from "../../../platform/configuration/common/configurationRegistry.ts";
import { InMemoryConfigurationService } from "../../../platform/configuration/common/inMemoryConfigurationService.ts";
import { ContextMenuService } from "../../../platform/contextview/browser/contextMenuService.ts";
import type { IExtension } from "../../../platform/extensions/common/iExtension.ts";
import type { IExtensionContributions } from "../../../platform/extensions/common/iExtensionManifest.ts";
import type { ILogger } from "../../../platform/log/common/iLogger.ts";
import { makeViewsHarness, testView } from "../../browser/parts/views/viewsService.testUtils.ts";
import { registerExtensionMenus } from "../../services/extensions/common/extensionMenuContributor.ts";
import type { IExtensionTreeDataSource } from "../common/iExtensionTreeViewsSink.ts";
import type { IWireTreeItem } from "../common/treeViewWireTypes.ts";

import { ExtensionTreeViewsAdapter } from "./extensionTreeViewsAdapter.ts";
import { ExtensionViewWelcomes } from "./extensionViewWelcomes.ts";

const VIEW = "ext.targets";

function item(handle: string, label: string, extra: Partial<IWireTreeItem> = {}): IWireTreeItem {
    return { handle, label, collapsibleState: 0, ...extra };
}

function extension(id: string, contributes: IExtensionContributions): IExtension {
    return { id, manifest: { name: id, publisher: "test", version: "0.0.1", contributes } } as unknown as IExtension;
}

/** Shaped like `hashicorp.terraform` (a provider row with docs) and `golang.go` (an env row with an inline Edit). */
const TERRAFORM_LIKE = extension("pub.a", {
    commands: [
        { command: "ext.edit", title: "Edit", icon: "$(edit)" },
        { command: "ext.reveal", title: "Reveal" },
    ],
    menus: {
        "view/item/context": [
            { command: "ext.openDocs", when: `view == ${VIEW} && viewItem == provider`, group: "navigation" },
            {
                command: "ext.copy",
                when: `view == ${VIEW} && viewItem =~ /^(provider|go:explorer:env)/`,
                group: "9_copy",
            },
            { command: "ext.edit", when: `view == ${VIEW} && viewItem == go:explorer:envfile`, group: "inline" },
            { command: "ext.reveal", when: `view == ${VIEW} && viewItem == go:explorer:envfile`, group: "inline@2" },
            { command: "ext.elsewhere", when: "view == other.view", group: "navigation" },
        ],
    },
});

const SECOND = extension("pub.b", {
    menus: { "view/item/context": [{ command: "b.inspect", when: "viewItem == provider", group: "z_b" }] },
});

const ROWS = [
    item("1/prov", "aws", { contextValue: "provider", collapsibleState: 1 }),
    item("1/env", "GOPATH", { contextValue: "go:explorer:envfile" }),
    item("1/plain", "plain"),
];

function source(children: Record<string, readonly IWireTreeItem[]>): IExtensionTreeDataSource {
    return {
        getChildren: (parent) => Promise.resolve(children[parent ?? ""] ?? []),
        executeCommand: () => Promise.resolve(),
        setVisible: () => undefined,
        setExpanded: () => undefined,
        setSelection: () => undefined,
    };
}

const COMMANDS: Record<string, string> = {
    "ext.openDocs": "Open Documentation",
    "ext.copy": "Copy Name",
    "ext.edit": "Edit",
    "ext.reveal": "Reveal",
    "ext.elsewhere": "Elsewhere",
    "b.inspect": "Inspect",
};

async function setup(
    options: { rows?: readonly IWireTreeItem[]; canSelectMany?: boolean; extensions?: readonly IExtension[] } = {},
) {
    const h = makeViewsHarness();
    h.service.registerContainer({ id: "sb", title: "SB", location: "sidebar", order: 0, isDefault: true });
    h.service.registerView(testView(VIEW, "sb", 0, { body: null }));
    h.commands.register(`${VIEW}.focus`, () => undefined);
    h.service.attachRegisteredContainers();
    h.showViewlet("sb");
    const executed: { id: string; args: unknown[] }[] = [];
    for (const [id, title] of Object.entries(COMMANDS)) {
        h.commands.register(id, (...args: unknown[]) => executed.push({ id, args }), title);
    }
    const warnings: string[] = [];
    const errors: string[] = [];
    const logger = { warn: (message: string) => warnings.push(message), error: () => undefined } as unknown as ILogger;
    registerExtensionMenus(options.extensions ?? [TERRAFORM_LIKE, SECOND], h.menuRegistry);
    const adapter = new ExtensionTreeViewsAdapter({
        views: h.service,
        welcomes: new ExtensionViewWelcomes(h.service, h.contextKeys, h.commands, {
            open: () => Promise.resolve(false),
        }),
        commands: h.commands,
        menus: h.menuRegistry,
        menuService: h.menuService,
        contextMenu: new ContextMenuService(h.menuService),
        contextKeys: h.contextKeys,
        configuration: new InMemoryConfigurationService(new ConfigurationRegistry()),
        workspace: h.workspace,
        colors: { resolve: () => undefined },
        notifyError: (message) => errors.push(message),
        logger,
    });
    const children: Record<string, readonly IWireTreeItem[]> = { "": options.rows ?? ROWS };
    adapter.register(
        { viewId: VIEW, showCollapseAll: false, canSelectMany: options.canSelectMany ?? false },
        source(children),
    );
    const app = TestApp.createWithContent(h.root("sb"), new Size(40, 12));
    await flushMicrotasks(10);
    const tree = adapter.getTree(VIEW);
    if (tree === undefined) throw new Error("no tree");
    tree.focus();
    const lines = (): string[] => {
        app.render();
        return app.backend.screenToString().split("\n");
    };
    /** Row `label`'s line and its first column. */
    const at = (label: string): { x: number; y: number } => {
        const y = lines().findIndex((line) => line.includes(label));
        if (y < 0) throw new Error(`no row "${label}"`);
        return { x: lines()[y].indexOf(label), y };
    };
    const mouse = (button: "left" | "right", x: number, y: number): void => {
        for (const action of ["press", "release"] as const) {
            const token: MouseToken = {
                kind: "mouse",
                button,
                x: x + 1,
                y: y + 1,
                action,
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
                raw: "",
            };
            app.backend.simulateMouse(token);
        }
        app.render();
    };
    const rightClick = (label: string): void => {
        const { x, y } = at(label);
        mouse("right", x, y);
    };
    const popup = (): PopupMenuElement | null => app.querySelector("PopupMenuElement") as PopupMenuElement | null;
    const menu = (): string[] => (popup()?.entries ?? []).map(entryLabel);
    const select = (label: string): void => {
        const entry = popup()?.entries.find((candidate) => entryLabel(candidate) === label);
        if (entry === undefined || entry.type === "separator" || entry.type === "submenu") throw new Error(label);
        entry.onSelect?.();
    };
    return {
        h,
        adapter,
        tree,
        app,
        executed,
        warnings,
        errors,
        children,
        lines,
        at,
        mouse,
        rightClick,
        menu,
        select,
        popup,
    };
}

function entryLabel(entry: MenuEntry): string {
    return entry.type === "separator" ? "─" : entry.label;
}

const rowArg = (handle: string) => ({ $treeViewId: VIEW, $treeItemHandle: handle });

const EDIT = CODICON_GLYPHS.edit;

describe("ExtensionTreeViewsAdapter — view/item/context menu", () => {
    it("a right click shows the row's items by `viewItem`, `navigation` first and groups apart", async () => {
        const f = await setup();
        f.rightClick("aws");
        expect(f.menu()).toEqual(["Open Documentation", "─", "Copy Name", "─", "Inspect"]);
        f.app.sendKey("Escape");
        f.rightClick("GOPATH");
        expect(f.menu()).toEqual(["Copy Name"]);
    });

    it("the chosen item runs its command with the row as `{ $treeViewId, $treeItemHandle }`", async () => {
        const f = await setup();
        f.rightClick("aws");
        f.select("Open Documentation");
        expect(f.executed).toEqual([{ id: "ext.openDocs", args: [rowArg("1/prov")] }]);
    });

    it("Shift+F10 opens the menu of the cursor row; Enter runs the first item", async () => {
        const f = await setup();
        f.app.sendKey("Shift+F10");
        f.app.render();
        expect(f.menu()).toEqual(["Open Documentation", "─", "Copy Name", "─", "Inspect"]);
        f.app.sendKey("Enter");
        expect(f.executed).toEqual([{ id: "ext.openDocs", args: [rowArg("1/prov")] }]);
    });

    it("a row without items opens no menu", async () => {
        const f = await setup();
        f.rightClick("plain");
        expect(f.popup()).toBeNull();
    });

    it("a row without a context value has no `viewItem`: only items that don't ask for it", async () => {
        const f = await setup({
            extensions: [
                extension("pub.c", {
                    menus: {
                        "view/item/context": [
                            { command: "ext.copy", when: "!viewItem" },
                            { command: "ext.openDocs", when: "viewItem" },
                        ],
                    },
                }),
            ],
        });
        f.rightClick("plain");
        expect(f.menu()).toEqual(["Copy Name"]);
    });

    it("a context menu item that throws or rejects is a toast", async () => {
        const f = await setup();
        f.h.commands.register(
            "ext.openDocs",
            () => {
                throw new Error("no docs");
            },
            "Open Documentation",
        );
        f.h.commands.register("ext.copy", () => Promise.reject(new Error("copy failed")), "Copy Name");
        f.rightClick("aws");
        f.select("Open Documentation");
        f.rightClick("aws");
        f.select("Copy Name");
        await flushMicrotasks(5);
        expect(f.errors).toEqual(["no docs", "copy failed"]);
    });

    it("an item of a command nobody registered is left out, with one Output line", async () => {
        const f = await setup({
            extensions: [
                extension("pub.c", {
                    menus: { "view/item/context": [{ command: "ext.ghost" }, { command: "ext.copy" }] },
                }),
            ],
        });
        f.rightClick("plain");
        expect(f.menu()).toEqual(["Copy Name"]);
        f.app.sendKey("Escape");
        f.rightClick("plain");
        expect(f.warnings).toEqual(['view/item/context: command "ext.ghost" is not registered, its item is not shown']);
    });

    it("after a refresh with a new context value the menu and the inline buttons follow it", async () => {
        const f = await setup();
        expect(f.lines().find((line) => line.includes("aws"))).not.toContain(EDIT);
        await f.adapter.refresh(VIEW, [item("1/prov", "aws", { contextValue: "go:explorer:envfile" })]);
        f.mouse("left", f.at("aws").x, f.at("aws").y);
        expect(f.lines().find((line) => line.includes("aws"))).toContain(EDIT);
        f.rightClick("aws");
        expect(f.menu()).toEqual(["Copy Name"]);
    });
});

describe("ExtensionTreeViewsAdapter — inline buttons", () => {
    it("the cursor row shows its inline items: the command's icon, or its title without one", async () => {
        const f = await setup();
        f.app.sendKey("ArrowDown");
        const row = f.lines().find((line) => line.includes("GOPATH")) ?? "";
        expect(row).toContain(EDIT);
        expect(row).toContain("Reveal");
        expect(row.indexOf(EDIT)).toBeLessThan(row.indexOf("Reveal"));
        expect(f.lines().find((line) => line.includes("aws"))).not.toContain(EDIT);
    });

    it("a click on a glyph runs its command with the row and neither expands nor opens it", async () => {
        const f = await setup({
            rows: [item("1/env", "GOPATH", { contextValue: "go:explorer:envfile", collapsibleState: 1 })],
        });
        f.children["1/env"] = [item("1/env/c", "child")];
        const { y } = f.at("GOPATH");
        const x = (f.lines()[y] ?? "").indexOf(EDIT);
        f.mouse("left", x, y);
        expect(f.executed).toEqual([{ id: "ext.edit", args: [rowArg("1/env")] }]);
        expect(f.tree.treeElement.getSelectedNode()?.handle).toBe("1/env");
        await flushMicrotasks(10);
        expect(f.lines().join("\n")).not.toContain("child");
    });

    it("a glyph whose command fails is a toast", async () => {
        const f = await setup();
        f.h.commands.register("ext.edit", () => Promise.reject(new Error("edit failed")));
        f.app.sendKey("ArrowDown");
        const { y } = f.at("GOPATH");
        f.mouse("left", (f.lines()[y] ?? "").indexOf(EDIT), y);
        await flushMicrotasks(5);
        expect(f.errors).toEqual(["edit failed"]);
    });

    it("a context key read by an inline item's `when` redraws the rows; an unrelated one does not ask the menu", async () => {
        const f = await setup({
            extensions: [
                extension("pub.c", {
                    commands: [{ command: "ext.edit", title: "Edit", icon: "$(edit)" }],
                    menus: { "view/item/context": [{ command: "ext.edit", when: "editable", group: "inline" }] },
                }),
            ],
        });
        expect(f.lines().find((line) => line.includes("aws"))).not.toContain(EDIT);
        const resolves = vi.spyOn(f.h.menuService, "getEntryGroups");
        f.h.contextKeys.setRaw("unrelated", true);
        await flushMicrotasks(10);
        expect(resolves).not.toHaveBeenCalled();
        f.h.contextKeys.setRaw("editable", true);
        await flushMicrotasks(10);
        expect(resolves).toHaveBeenCalled();
        expect(f.lines().find((line) => line.includes("aws"))).toContain(EDIT);
    });

    it("an item added to the menu later shows on the rows", async () => {
        const f = await setup({ extensions: [] });
        registerExtensionMenus(
            [
                extension("pub.c", {
                    commands: [{ command: "ext.edit", title: "Edit", icon: "$(edit)" }],
                    menus: { "view/item/context": [{ command: "ext.edit", group: "inline" }] },
                }),
            ],
            f.h.menuRegistry,
        );
        await flushMicrotasks(10);
        expect(f.lines().find((line) => line.includes("aws"))).toContain(EDIT);
    });
});

describe("ExtensionTreeViewsAdapter — multiple selection", () => {
    async function selectBoth(f: Awaited<ReturnType<typeof setup>>): Promise<void> {
        f.app.sendKey("Shift+ArrowDown");
        f.app.render();
        await flushMicrotasks(5);
        expect(f.tree.treeElement.getSelectedNodes().map((node) => node.handle)).toEqual(["1/prov", "1/env"]);
    }

    it("a right click inside the selection shows only the items every selected row has, the selection goes second", async () => {
        const f = await setup({ canSelectMany: true });
        await selectBoth(f);
        f.rightClick("GOPATH");
        expect(f.menu()).toEqual(["Copy Name"]);
        f.select("Copy Name");
        expect(f.executed).toEqual([{ id: "ext.copy", args: [rowArg("1/env"), [rowArg("1/prov"), rowArg("1/env")]] }]);
    });

    it("without `canSelectMany` only the clicked row counts", async () => {
        const f = await setup({ canSelectMany: false });
        f.app.sendKey("Shift+ArrowDown");
        f.rightClick("aws");
        f.select("Copy Name");
        expect(f.executed).toEqual([{ id: "ext.copy", args: [rowArg("1/prov")] }]);
    });
});
