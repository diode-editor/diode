import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import type { IStubRpc } from "./testStubRpc.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { StatusBarAlignment } from "./vscodeTypes.ts";
import { createWindowNamespace } from "./windowNamespace.ts";
import type { IWireStatusBarItem } from "./wireTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

function makeWindow(): { stub: IStubRpc; window: typeof vscode.window; owner: ExtensionOwner } {
    const stub = makeStubRpc();
    const owner = new ExtensionOwner();
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner,
    };
    return { stub, window: createWindowNamespace(ctx), owner };
}

function statusBarTraffic(stub: IStubRpc): { method: string; params: IWireStatusBarItem }[] {
    return stub.notifies
        .filter((n) => n.method.startsWith("window.statusBarItem."))
        .map((n) => ({ method: n.method, params: n.params as IWireStatusBarItem }));
}

function lastUpdate(stub: IStubRpc): IWireStatusBarItem {
    const updates = statusBarTraffic(stub).filter((n) => n.method === "window.statusBarItem.update");
    const last = updates.at(-1);
    if (last === undefined) throw new Error("no window.statusBarItem.update at all");
    return last.params;
}

describe("window.createStatusBarItem: item state in the subprocess", () => {
    it("an item created but not shown does not appear on the wire", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem();
        item.text = "Demo";
        item.name = "Status Bar Demo";
        item.command = "demo.click";

        expect(statusBarTraffic(stub)).toEqual([]);
    });

    it("show() sends the full item state", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem(StatusBarAlignment.Right as vscode.StatusBarAlignment, 100);
        item.text = "$(check) Demo";
        item.name = "Status Bar Demo";
        item.command = "demo.click";
        item.show();

        // toStrictEqual, not toEqual: the message must not carry keys with
        // undefined values; the bar cannot tell them apart from "not set".
        expect(lastUpdate(stub)).toStrictEqual({
            handle: 1,
            id: "status-bar-demo",
            alignment: "right",
            priority: 100,
            text: "$(check) Demo",
            name: "Status Bar Demo",
            command: "demo.click",
        });
    });

    it("an item without name, command and priority has no such keys in the message", () => {
        const { stub, window } = makeWindow();
        window.createStatusBarItem().show();

        expect(lastUpdate(stub)).toStrictEqual({
            handle: 1,
            id: "item-1",
            alignment: "left",
            text: "",
        });
    });

    it("editing a shown item reaches the bar", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem();
        item.text = "Demo";
        item.show();
        item.text = "Demo 42";

        expect(lastUpdate(stub).text).toBe("Demo 42");
    });

    it("alignment defaults to left, priority is absent", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem();
        item.text = "Demo";
        item.show();

        const update = lastUpdate(stub);
        expect(update.alignment).toBe("left");
        expect(update.priority).toBeUndefined();
        expect(item.priority).toBeUndefined();
        expect(item.alignment).toBe(StatusBarAlignment.Left);
    });

    it("overload with an explicit id: id is sent as is, alignment and priority are shifted", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem("my.item", StatusBarAlignment.Right as vscode.StatusBarAlignment, 7);
        item.name = "Name ignored, id set explicitly";
        item.show();

        expect(item.id).toBe("my.item");
        expect(item.priority).toBe(7);
        expect(item.alignment).toBe(StatusBarAlignment.Right);
        expect(lastUpdate(stub)).toMatchObject({ id: "my.item", alignment: "right", priority: 7 });
    });

    it("without a name the id is synthesized from a counter and differs between two items", () => {
        const { window } = makeWindow();
        const first = window.createStatusBarItem();
        const second = window.createStatusBarItem();

        expect(first.id).toBe("item-1");
        expect(second.id).toBe("item-2");
    });

    it("name-based id is stable: same name, same id (survives restart)", () => {
        const { window } = makeWindow();
        const item = window.createStatusBarItem();
        item.name = "Status Bar Demo";

        expect(item.id).toBe("status-bar-demo");
    });

    it("a name without Latin letters or digits does not yield an empty id", () => {
        const { window } = makeWindow();
        const item = window.createStatusBarItem();
        item.name = "\u041f\u0440\u0438\u0432\u0435\u0442"; // "Privet": no Latin letters or digits

        expect(item.id).toBe("item-1");
    });

    it("set fields read back (extensions do exactly that)", () => {
        const { window } = makeWindow();
        const item = window.createStatusBarItem();
        item.text = "Demo";
        item.name = "Status Bar Demo";
        item.command = "demo.click";

        expect(item.text).toBe("Demo");
        expect(item.name).toBe("Status Bar Demo");
        expect(item.command).toBe("demo.click");
    });

    it("hide() removes the item from the bar, repeated hide is silent", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem();
        item.show();
        item.hide();
        item.hide();

        expect(statusBarTraffic(stub).map((n) => n.method)).toEqual([
            "window.statusBarItem.update",
            "window.statusBarItem.dispose",
        ]);
    });

    it("editing a hidden item is not sent, and show() brings it back with the new text", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem();
        item.text = "Demo";
        item.show();
        item.hide();
        item.text = "Demo 42";
        expect(statusBarTraffic(stub)).toHaveLength(2);

        item.show();
        expect(lastUpdate(stub).text).toBe("Demo 42");
    });

    it("repeated show() of a shown item sends nothing extra", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem();
        item.show();
        item.show();

        expect(statusBarTraffic(stub)).toHaveLength(1);
    });

    it("dispose() of a shown item removes it from the bar", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem();
        item.show();
        item.dispose();

        expect(statusBarTraffic(stub).map((n) => n.method)).toEqual([
            "window.statusBarItem.update",
            "window.statusBarItem.dispose",
        ]);
    });

    it("dispose() removes the item and the handle becomes inert", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem();
        item.text = "Demo";
        item.show();
        item.dispose();
        item.text = "Demo 42";
        item.show();
        item.hide();
        item.dispose();

        expect(statusBarTraffic(stub).map((n) => n.method)).toEqual([
            "window.statusBarItem.update",
            "window.statusBarItem.dispose",
        ]);
    });

    it("dispose() of an unshown item sends nothing", () => {
        const { stub, window } = makeWindow();
        window.createStatusBarItem().dispose();

        expect(statusBarTraffic(stub)).toEqual([]);
    });

    it("command as an object: id and arguments are sent", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem();
        item.command = { title: "Click", command: "demo.click", arguments: [1, "two"] };
        item.show();

        expect(lastUpdate(stub)).toMatchObject({ command: "demo.click", arguments: [1, "two"] });
    });

    it("command as an object without arguments: no arguments key", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem();
        item.command = { title: "Click", command: "demo.click" };
        item.show();

        expect(lastUpdate(stub).arguments).toBeUndefined();
    });

    it("a cleared command is no longer sent", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem();
        item.command = "demo.click";
        item.show();
        item.command = undefined;

        expect(lastUpdate(stub).command).toBeUndefined();
    });

    it("tooltip/colors are accepted, read back and do not touch the wire", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem();
        item.show();
        const before = statusBarTraffic(stub).length;
        item.tooltip = "Tooltip";
        item.color = "#ff0000";
        item.backgroundColor = { id: "statusBarItem.errorBackground" } as vscode.ThemeColor;
        item.accessibilityInformation = { label: "Demo" };

        expect(statusBarTraffic(stub)).toHaveLength(before);
        expect(item.tooltip).toBe("Tooltip");
        expect(item.color).toBe("#ff0000");
        expect(item.backgroundColor).toEqual({ id: "statusBarItem.errorBackground" });
        expect(item.accessibilityInformation).toEqual({ label: "Demo" });
    });

    it("renaming a shown item also changes its id on the wire", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem();
        item.show();
        expect(lastUpdate(stub).id).toBe("item-1");

        item.name = "Status Bar Demo";
        expect(lastUpdate(stub)).toMatchObject({ id: "status-bar-demo", name: "Status Bar Demo" });
    });

    it("two items keep independent handles", () => {
        const { stub, window } = makeWindow();
        const first = window.createStatusBarItem();
        const second = window.createStatusBarItem();
        first.show();
        second.show();
        first.hide();

        expect(statusBarTraffic(stub).map((n) => [n.method, n.params.handle])).toEqual([
            ["window.statusBarItem.update", 1],
            ["window.statusBarItem.update", 2],
            ["window.statusBarItem.dispose", 1],
        ]);
    });

    it("non-numeric priority does not reach the wire", () => {
        const { stub, window } = makeWindow();
        // An extension may pass anything: types are optional for it.
        const item = window.createStatusBarItem(undefined, Number.NaN);
        item.show();

        expect(lastUpdate(stub).priority).toBeUndefined();
    });

    describe("owner-qualified id `<extension id>.<item id>`, like asStatusBarItemIdentifier", () => {
        it("explicit id is prefixed with the owner, both in item.id and on the wire", () => {
            const { stub, window, owner } = makeWindow();
            const item = owner.runAs("pub.ext", () => window.createStatusBarItem("my.item"));
            item.show();

            expect(item.id).toBe("pub.ext.my.item");
            expect(lastUpdate(stub).id).toBe("pub.ext.my.item");
        });

        it("without a name: owner and counter", () => {
            const { window, owner } = makeWindow();
            const item = owner.runAs("pub.ext", () => window.createStatusBarItem());

            expect(item.id).toBe("pub.ext.item-1");
        });

        it("owner is fixed at creation: a name set later outside the call keeps the id", () => {
            const { window, owner } = makeWindow();
            const item = owner.runAs("pub.ext", () => window.createStatusBarItem());
            item.name = "Status Bar Demo";
            expect(item.id).toBe("pub.ext.status-bar-demo");

            owner.runAs("other.ext", () => {
                item.name = "Renamed";
            });
            expect(item.id).toBe("pub.ext.renamed");
        });

        it("same names in different extensions yield different ids", () => {
            const { window, owner } = makeWindow();
            const a = owner.runAs("a.one", () => window.createStatusBarItem());
            const b = owner.runAs("b.two", () => window.createStatusBarItem());
            a.name = "Demo";
            b.name = "Demo";

            expect([a.id, b.id]).toEqual(["a.one.demo", "b.two.demo"]);
        });
    });
});
