import { describe, expect, it, vi } from "vitest";

import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { codicon, type IProductIcon } from "../../../../base/common/codicons.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type {
    CallHierarchyProvider,
    ICallHierarchyItem,
} from "../../../../editor/common/languages/iCallHierarchySource.ts";
import { NERD_FONT_ICONS } from "../../../../platform/theme/common/productIconService.ts";

import { CallHierarchyTreeProvider, callNodeTarget, CallsModel } from "./callHierarchyModel.ts";

function item(itemId: number, name: string, uri = "file:///a.ts", line = 0): ICallHierarchyItem {
    const range = createRange(line, 3, line, 6);
    return { itemId, name, kind: 11, uri, range, selectionRange: createRange(line, 4, line, 5) };
}

function provider(overrides: Partial<CallHierarchyProvider> = {}): CallHierarchyProvider {
    return {
        prepareCallHierarchy: () => Promise.resolve(null),
        provideIncomingCalls: vi.fn(() => Promise.resolve([])),
        provideOutgoingCalls: vi.fn(() => Promise.resolve([])),
        releaseCallHierarchy: vi.fn(),
        ...overrides,
    };
}

describe("CallsModel", () => {
    it("asks the provider of its direction by session and item, once, and keeps the answer in the node", async () => {
        const fake = provider({
            provideIncomingCalls: vi.fn(() => Promise.resolve([{ from: item(2, "caller"), fromRanges: [] }])),
        });
        const model = new CallsModel(fake, 7, "incoming", [item(1, "root")], CancellationTokenNone);
        const [root] = model.roots;

        const [first, second] = await Promise.all([model.getChildren(root), model.getChildren(root)]);
        expect(first.map((node) => node.item.name)).toEqual(["caller"]);
        expect(second).toBe(first);
        expect(fake.provideIncomingCalls).toHaveBeenCalledTimes(1);
        expect(fake.provideIncomingCalls).toHaveBeenCalledWith(7, 1, CancellationTokenNone);
        expect(fake.provideOutgoingCalls).not.toHaveBeenCalled();
    });

    it("the outgoing direction takes `to`", async () => {
        const range = createRange(0, 0, 0, 1);
        const fake = provider({
            provideOutgoingCalls: vi.fn(() => Promise.resolve([{ to: item(2, "callee"), fromRanges: [range] }])),
        });
        const model = new CallsModel(fake, 7, "outgoing", [item(1, "root")], CancellationTokenNone);
        const [callee] = await model.getChildren(model.roots[0]);
        expect(callee.item.name).toBe("callee");
        expect(callee.fromRanges).toEqual([range]);
        expect(fake.provideIncomingCalls).not.toHaveBeenCalled();
    });

    it("sorts children by uri and then by the start of the range", async () => {
        const fake = provider({
            provideIncomingCalls: () =>
                Promise.resolve([
                    { from: item(2, "b late", "file:///b.ts", 9), fromRanges: [] },
                    { from: item(3, "a late", "file:///a.ts", 5), fromRanges: [] },
                    { from: item(4, "b early", "file:///b.ts", 1), fromRanges: [] },
                    { from: item(5, "a early", "file:///a.ts", 2), fromRanges: [] },
                ]),
        });
        const model = new CallsModel(fake, 1, "incoming", [item(1, "root")], CancellationTokenNone);
        const children = await model.getChildren(model.roots[0]);
        expect(children.map((node) => node.item.name)).toEqual(["a early", "a late", "b early", "b late"]);
    });
});

describe("callNodeTarget", () => {
    const node = { item: item(1, "x", "file:///a.ts", 4) };
    const ranges = [createRange(8, 1, 8, 2), createRange(6, 2, 6, 3), createRange(6, 9, 6, 10)];

    it("outgoing opens the target's name, whatever the call ranges", () => {
        expect(callNodeTarget("outgoing", { ...node, fromRanges: ranges })).toEqual({ line: 4, character: 4 });
    });

    it("incoming opens the earliest call", () => {
        expect(callNodeTarget("incoming", { ...node, fromRanges: ranges })).toEqual({ line: 6, character: 2 });
    });

    it("incoming without calls (a root) opens the name", () => {
        expect(callNodeTarget("incoming", node)).toEqual({ line: 4, character: 4 });
        expect(callNodeTarget("incoming", { ...node, fromRanges: [] })).toEqual({ line: 4, character: 4 });
    });
});

describe("CallHierarchyTreeProvider", () => {
    const tree = (): CallHierarchyTreeProvider => new CallHierarchyTreeProvider(NERD_FONT_ICONS);

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
        const unicode = new CallHierarchyTreeProvider({
            ...NERD_FONT_ICONS,
            glyph: (icon: IProductIcon | string) => (typeof icon === "string" ? icon : icon.unicode),
        });
        for (let kind = 0; kind <= 25; kind++) {
            expect(unicode.getTreeItem({ item: { ...item(1, "x"), kind } }).icon, `kind ${String(kind)}`).toBeTruthy();
        }
        for (const button of ["call-incoming", "call-outgoing", "close"]) {
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
