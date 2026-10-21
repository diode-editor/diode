import { describe, expect, it } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";
import {
    MarkdownString,
    ThemeColor,
    ThemeIcon,
    TreeItem,
    TreeItemCheckboxState,
    TreeItemCollapsibleState,
    Uri,
} from "./vscodeTypes.ts";

describe("TreeItem: value for tree nodes", () => {
    it("string label: label set, no resourceUri, collapsibleState defaults to None", () => {
        const item = new TreeItem("//app:main");

        expect(item.label).toBe("//app:main");
        expect(item.resourceUri).toBeUndefined();
        expect(item.collapsibleState).toBe(TreeItemCollapsibleState.None);
    });

    it("TreeItemLabel label and explicit collapsible state", () => {
        const label = { label: "app", highlights: [[0, 1]] as [number, number][] };
        const item = new TreeItem(label, TreeItemCollapsibleState.Expanded);

        expect(item.label).toBe(label);
        expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Expanded);
    });

    it("Uri as the first argument goes to resourceUri, label is unset", () => {
        const uri = Uri.file("/ws/BUILD.bazel");
        const item = new TreeItem(uri, TreeItemCollapsibleState.Collapsed);

        expect(item.resourceUri).toBe(uri);
        expect(item.label).toBeUndefined();
        expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
    });

    it("subclass with writable fields, like a typical provider node", () => {
        class Target extends TreeItem {
            public constructor(public readonly target: string) {
                super(target, TreeItemCollapsibleState.None);
                this.description = "java_binary";
                this.tooltip = new MarkdownString(`**${target}**`);
                this.iconPath = new ThemeIcon("play", new ThemeColor("charts.green"));
                this.contextValue = "runnable";
                this.command = { command: "bazel.run", title: "Run", arguments: [target] };
                this.id = target;
            }
        }

        const node = new Target("//app:main");

        expect(node).toBeInstanceOf(TreeItem);
        expect(node.label).toBe("//app:main");
        expect(node.description).toBe("java_binary");
        expect(node.contextValue).toBe("runnable");
        expect(node.command?.arguments).toEqual(["//app:main"]);
        expect(node.id).toBe("//app:main");
        expect((node.iconPath as ThemeIcon).id).toBe("play");
    });

    it("optional fields do not shadow subclass getters (fields are not own properties)", () => {
        // TS forbids such an override (TS2611), but an extension's JS bundle does not.
        class Lazy extends TreeItem {}
        Object.defineProperty(Lazy.prototype, "tooltip", { get: () => "from getter" });
        Object.defineProperty(Lazy.prototype, "description", { get: () => "from getter, too" });

        const node = new Lazy("x");

        expect(node.tooltip).toBe("from getter");
        expect(node.description).toBe("from getter, too");
        expect(Object.keys(new TreeItem("y"))).toEqual(["collapsibleState", "label"]);
    });
});

describe("ThemeIcon / tree enums", () => {
    it("ThemeIcon holds id and color; File/Folder are upstream statics", () => {
        const color = new ThemeColor("charts.red");
        const icon = new ThemeIcon("sync~spin", color);

        expect(icon.id).toBe("sync~spin");
        expect(icon.color).toBe(color);
        expect(new ThemeIcon("x").color).toBeUndefined();
        expect(ThemeIcon.File).toBeInstanceOf(ThemeIcon);
        expect(ThemeIcon.File.id).toBe("file");
        expect(ThemeIcon.Folder.id).toBe("folder");
    });

    it("enum values match upstream", () => {
        expect(TreeItemCollapsibleState.None).toBe(0);
        expect(TreeItemCollapsibleState.Collapsed).toBe(1);
        expect(TreeItemCollapsibleState.Expanded).toBe(2);
        expect(TreeItemCheckboxState.Unchecked).toBe(0);
        expect(TreeItemCheckboxState.Checked).toBe(1);
    });

    it("the four values are available from the vscode module", () => {
        const { namespace } = buildVscodeNamespace(makeStubRpc().rpc, createNodeExtHostDisk());

        expect(namespace.TreeItem).toBe(TreeItem);
        expect(namespace.TreeItemCollapsibleState).toBe(TreeItemCollapsibleState);
        expect(namespace.TreeItemCheckboxState).toBe(TreeItemCheckboxState);
        expect(namespace.ThemeIcon).toBe(ThemeIcon);
    });
});
