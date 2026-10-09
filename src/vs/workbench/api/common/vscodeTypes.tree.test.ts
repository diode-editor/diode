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

// Значения деревьев: провайдер объявляет `class Node extends vscode.TreeItem`
// на уровне модуля — без класса точка входа расширения не грузится вовсе.
// Форма и дефолты — эталонные (`extHostTypes.ts`).

describe("TreeItem — значение для узлов дерева", () => {
    it("подпись строкой: label задан, resourceUri нет, collapsibleState по умолчанию None", () => {
        const item = new TreeItem("//app:main");

        expect(item.label).toBe("//app:main");
        expect(item.resourceUri).toBeUndefined();
        // Дефолт эталона — None (0), а не undefined: рендер и провайдеры сравнивают с enum'ом.
        expect(item.collapsibleState).toBe(TreeItemCollapsibleState.None);
    });

    it("подпись TreeItemLabel и явное состояние раскрытия", () => {
        const label = { label: "app", highlights: [[0, 1]] as [number, number][] };
        const item = new TreeItem(label, TreeItemCollapsibleState.Expanded);

        expect(item.label).toBe(label);
        expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Expanded);
    });

    it("Uri первым аргументом идёт в resourceUri, label не задан", () => {
        const uri = Uri.file("/ws/BUILD.bazel");
        const item = new TreeItem(uri, TreeItemCollapsibleState.Collapsed);

        expect(item.resourceUri).toBe(uri);
        expect(item.label).toBeUndefined();
        expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
    });

    it("подкласс с записываемыми полями — как типовой узел провайдера", () => {
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

    it("необязательные поля не затеняют геттеры подкласса (поля — не собственные свойства)", () => {
        // TS такой override запрещает (TS2611), а JS-бандл расширения — нет:
        // геттер на прототипе подкласса, как его оставляет сборщик.
        class Lazy extends TreeItem {}
        Object.defineProperty(Lazy.prototype, "tooltip", { get: () => "из геттера" });
        Object.defineProperty(Lazy.prototype, "description", { get: () => "из геттера, тоже" });

        const node = new Lazy("x");

        expect(node.tooltip).toBe("из геттера");
        expect(node.description).toBe("из геттера, тоже");
        expect(Object.keys(new TreeItem("y"))).toEqual(["collapsibleState", "label"]);
    });
});

describe("ThemeIcon / enum'ы деревьев", () => {
    it("ThemeIcon держит id и цвет; File/Folder — статики эталона", () => {
        const color = new ThemeColor("charts.red");
        const icon = new ThemeIcon("sync~spin", color);

        expect(icon.id).toBe("sync~spin");
        expect(icon.color).toBe(color);
        expect(new ThemeIcon("x").color).toBeUndefined();
        expect(ThemeIcon.File).toBeInstanceOf(ThemeIcon);
        expect(ThemeIcon.File.id).toBe("file");
        expect(ThemeIcon.Folder.id).toBe("folder");
    });

    it("значения enum'ов — эталонные", () => {
        expect(TreeItemCollapsibleState.None).toBe(0);
        expect(TreeItemCollapsibleState.Collapsed).toBe(1);
        expect(TreeItemCollapsibleState.Expanded).toBe(2);
        expect(TreeItemCheckboxState.Unchecked).toBe(0);
        expect(TreeItemCheckboxState.Checked).toBe(1);
    });

    it("четыре значения доступны из модуля vscode", () => {
        const { namespace } = buildVscodeNamespace(makeStubRpc().rpc, createNodeExtHostDisk());

        expect(namespace.TreeItem).toBe(TreeItem);
        expect(namespace.TreeItemCollapsibleState).toBe(TreeItemCollapsibleState);
        expect(namespace.TreeItemCheckboxState).toBe(TreeItemCheckboxState);
        expect(namespace.ThemeIcon).toBe(ThemeIcon);
    });
});
