import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle, waitUntil } from "../../../../../TestUtils/timing.ts";
import type {
    IExtensionTreeDataSource,
    IExtensionTreeViewsSink,
} from "../../../../workbench/api/common/iExtensionTreeViewsSink.ts";
import type {
    IWireTreeItem,
    IWireTreeViewRegistration,
    IWireTreeViewReveal,
    IWireTreeViewTitle,
} from "../../../../workbench/api/common/treeViewWireTypes.ts";

interface IRecordingSink extends IExtensionTreeViewsSink {
    readonly registrations: { registration: IWireTreeViewRegistration; source: IExtensionTreeDataSource }[];
    readonly refreshes: { viewId: string; items: readonly IWireTreeItem[] | undefined }[];
    readonly titles: IWireTreeViewTitle[];
    readonly messages: string[];
    readonly reveals: IWireTreeViewReveal[];
    readonly unregistered: string[];
    resets: number;
}

function recordingSink(): IRecordingSink {
    const sink: IRecordingSink = {
        registrations: [],
        refreshes: [],
        titles: [],
        messages: [],
        reveals: [],
        unregistered: [],
        resets: 0,
        register: (registration, source) => {
            sink.registrations.push({ registration, source });
        },
        unregister: (viewId) => {
            sink.unregistered.push(viewId);
        },
        refresh: (viewId, items) => {
            sink.refreshes.push({ viewId, items });
            return Promise.resolve();
        },
        reveal: (request) => {
            sink.reveals.push(request);
            return Promise.resolve();
        },
        setMessage: (_viewId, message) => {
            sink.messages.push(message);
        },
        setTitle: (title) => {
            sink.titles.push(title);
        },
        reset: () => {
            sink.resets++;
        },
    };
    return sink;
}

interface IFixtureState {
    readonly runs: string[];
    readonly events: string[];
    readonly visible: boolean;
}

// The extension's elements stay in the subprocess: the host sees rows by handle over the real wire.
describe("ExtensionHost — extension tree views over the wire", () => {
    let sink: IRecordingSink;
    let harness: IExtensionHarness;

    beforeEach(async () => {
        sink = recordingSink();
        harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.tree", "treeViewExtension.cjs")],
            treeViewsSink: sink,
        });
        await waitUntil("the tree registration", () => sink.registrations.length === 1);
    });

    afterEach(async () => {
        await harness.dispose();
    });

    const source = (): IExtensionTreeDataSource => sink.registrations[0].source;
    const state = async (): Promise<IFixtureState> =>
        (await harness.commandRegistry.execute("test.tree.state")) as IFixtureState;

    it("createTreeView registers the view with its options and the owner", () => {
        expect(sink.registrations[0].registration).toEqual({
            viewId: "test.targets",
            showCollapseAll: true,
            canSelectMany: false,
            extensionId: "test.tree",
        });
    });

    it("a host command with row handles reaches the extension as its own elements, the selection too", async () => {
        await source().getChildren(undefined);
        const row = (handle: string) => ({ $treeViewId: "test.targets", $treeItemHandle: handle });
        await harness.commandRegistry.execute("test.tree.inspect", row("1/lib"));
        await harness.commandRegistry.execute("test.tree.inspect", row("1/lib"), [row("0/0:///app"), row("1/lib")]);
        await harness.commandRegistry.execute("test.tree.inspect", row("1/gone"));
        expect((await state()).runs).toEqual([
            "inspect //lib:same",
            "inspect //lib:same [//app:same,//lib:same]",
            "inspect undefined",
        ]);
    });

    it("rows carry upstream handles: `1/<id>`, or `<parent>/<n>:<label>` with the first slash escaped", async () => {
        const roots = await source().getChildren(undefined);
        expect(roots).toEqual([
            {
                handle: "0/0:///app",
                label: "//app",
                collapsibleState: 1,
                themeIcon: { id: "play" },
                contextValue: "target",
            },
            {
                handle: "1/lib",
                label: "//lib",
                description: "library",
                collapsibleState: 0,
                themeIcon: { id: "play" },
                contextValue: "target",
            },
        ]);
        const children = await source().getChildren("0/0:///app");
        expect(children.map((item) => [item.handle, item.parentHandle, item.command])).toEqual([
            ["0/0:///app/0:///app:main", "0/0:///app", { id: "test.tree.run", title: "Run" }],
            ["0/0:///app/0:///app:test", "0/0:///app", undefined],
        ]);
    });

    it("executeCommand runs the row's command in the subprocess with the extension's own argument", async () => {
        await source().getChildren(undefined);
        await source().getChildren("0/0:///app");
        await source().executeCommand("0/0:///app/0:///app:main");
        expect((await state()).runs).toEqual(["//app:main:same"]);
    });

    it("visibility, expansion and selection reach the TreeView events", async () => {
        await source().getChildren(undefined);
        source().setVisible(true);
        source().setExpanded("0/0:///app", true);
        source().setSelection(["1/lib"], "1/lib");
        source().setExpanded("0/0:///app", false);
        // Notifications go before the state request on the same channel.
        expect(await state()).toMatchObject({
            visible: true,
            events: ["visible:true", "expand://app", "selection://lib", "collapse://app"],
        });
    });

    it("fire() rereads the root; fire(el) sends the changed row", async () => {
        await source().getChildren(undefined);
        await harness.commandRegistry.execute("test.tree.fireLib");
        await waitUntil("a refresh", () => sink.refreshes.length === 1);
        expect(sink.refreshes[0].items?.map((item) => [item.handle, item.description])).toEqual([["1/lib", "renamed"]]);

        // Past the debounce window: the next change goes at once again.
        await settle(250);
        await harness.commandRegistry.execute("test.tree.fireRoot");
        await waitUntil("a second refresh", () => sink.refreshes.length === 2);
        expect(sink.refreshes[1]).toEqual({ viewId: "test.targets", items: undefined });
        expect((await source().getChildren(undefined)).map((item) => item.label)).toEqual(["//lib", "//tools"]);
    });

    it("a burst of fire() is one request at once and one after the debounce window", async () => {
        await source().getChildren(undefined);
        await harness.commandRegistry.execute("test.tree.burst");
        await waitUntil("a refresh", () => sink.refreshes.length === 1);
        await settle(400);
        expect(sink.refreshes).toHaveLength(2);
    });

    it("an exception in getChildren rejects the request with the extension's message", async () => {
        await harness.commandRegistry.execute("test.tree.fail", true);
        await expect(source().getChildren(undefined)).rejects.toThrow(/getChildren exploded/);
        await harness.commandRegistry.execute("test.tree.fail", false);
        expect(await source().getChildren(undefined)).toHaveLength(2);
    });

    it("title, description and message reach the host", async () => {
        await harness.commandRegistry.execute("test.tree.setTitle");
        await waitUntil("the message", () => sink.messages.length === 1);
        expect(sink.titles.at(-1)).toEqual({ viewId: "test.targets", title: "Targets", description: "3 found" });
        expect(sink.messages).toEqual(["Pick a target"]);
    });

    it("reveal without getParent rejects, as upstream", async () => {
        expect(await harness.commandRegistry.execute("test.tree.revealWithoutParent")).toBe(
            "Required registered TreeDataProvider to implement 'getParent' method to access 'reveal' method",
        );
        expect(sink.reveals).toEqual([]);
    });

    it("a repeated registration replaces the provider; disposing the old view leaves the new one", async () => {
        await harness.commandRegistry.execute("test.tree.reregister");
        await waitUntil("the second registration", () => sink.registrations.length === 2);
        const second = sink.registrations[1].source;
        expect((await second.getChildren(undefined)).map((item) => item.label)).toEqual(["second provider"]);

        await harness.commandRegistry.execute("test.tree.disposeFirst");
        expect((await second.getChildren(undefined)).map((item) => item.label)).toEqual(["second provider"]);
        expect(sink.unregistered).toEqual([]);
    });

    it("the subprocess going away resets every tree", async () => {
        await harness.host.shutdown();
        expect(sink.resets).toBe(1);
    });
});
