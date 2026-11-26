import { describe, expect, it } from "vitest";

import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { codicon, type IProductIcon } from "../../../../base/common/codicons.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type {
    CallHierarchyProvider,
    ICallHierarchyItem,
} from "../../../../editor/common/languages/iCallHierarchySource.ts";
import { NERD_FONT_ICONS } from "../../../../platform/theme/common/productIconService.ts";

import { CallsModel } from "./callHierarchyModel.ts";
import { HierarchyTreeProvider } from "./hierarchyTree.ts";

function item(itemId: number, name: string, uri = "file:///a.ts", line = 0): ICallHierarchyItem {
    const range = createRange(line, 3, line, 6);
    return { itemId, name, kind: 11, uri, range, selectionRange: createRange(line, 4, line, 5) };
}

describe("HierarchyTreeProvider", () => {
    const tree = (): HierarchyTreeProvider => new HierarchyTreeProvider(NERD_FONT_ICONS);

    it("a row: name, detail, the icon of its kind, always collapsible", () => {
        const row = tree().getTreeItem({ item: { ...item(1, "run"), detail: "src/a.ts", kind: 5 } });
        expect(row).toEqual({
            label: "run",
            description: "src/a.ts",
            collapsible: true,
            openable: true,
            icon: NERD_FONT_ICONS.glyph(codicon("symbol-method")),
        });
    });

    it("every SymbolKind has a glyph; an unknown kind has no icon", () => {
        const provider = tree();
        for (let kind = 0; kind <= 25; kind++) {
            expect(provider.getTreeItem({ item: { ...item(1, "x"), kind } }).icon, `kind ${String(kind)}`).toBeTruthy();
        }
        expect(provider.getTreeItem({ item: { ...item(1, "x"), kind: 99 } })).toStrictEqual({
            label: "x",
            collapsible: true,
            openable: true,
        });
    });

    it("every SymbolKind has a glyph without a nerd font too, like the title buttons", () => {
        const unicode = new HierarchyTreeProvider({
            ...NERD_FONT_ICONS,
            glyph: (icon: IProductIcon | string) => (typeof icon === "string" ? icon : icon.unicode),
        });
        for (let kind = 0; kind <= 25; kind++) {
            expect(unicode.getTreeItem({ item: { ...item(1, "x"), kind } }).icon, `kind ${String(kind)}`).toBeTruthy();
        }
        for (const button of [
            "call-incoming",
            "call-outgoing",
            "type-hierarchy-sub",
            "type-hierarchy-super",
            "close",
        ]) {
            expect(codicon(button).unicode, button).not.toBe("");
        }
    });

    it("the deprecated tag goes into the label, another tag doesn't", () => {
        const provider = tree();
        expect(provider.getTreeItem({ item: { ...item(1, "old"), tags: [1] } }).label).toBe("old (deprecated)");
        expect(provider.getTreeItem({ item: { ...item(1, "new"), tags: [2] } }).label).toBe("new");
    });

    it("without a model there are no rows; with one, the roots and then the model's children", async () => {
        const provider = tree();
        expect(provider.getChildren()).toEqual([]);
        const fake = {
            provideIncomingCalls: () => Promise.resolve([{ from: item(2, "caller"), fromRanges: [] }]),
        } as unknown as CallHierarchyProvider;
        const model = new CallsModel(fake, 1, "incoming", [item(1, "root")], CancellationTokenNone);
        provider.setModel(model);
        expect(provider.getChildren()).toEqual(model.roots);
        expect((await provider.getChildren(model.roots[0])).map((n) => n.item.name)).toEqual(["caller"]);
    });

    it("a new model changes the keys, so a rerooted item isn't taken for an already expanded row", () => {
        const provider = tree();
        const node = { item: item(1, "x") };
        const before = provider.getKey(node);
        expect(provider.getKey({ item: item(2, "y") })).not.toBe(before);
        provider.setModel(null);
        expect(provider.getKey(node)).not.toBe(before);
    });
});
