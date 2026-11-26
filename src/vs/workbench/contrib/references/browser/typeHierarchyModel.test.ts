import { describe, expect, it, vi } from "vitest";

import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type {
    ITypeHierarchyItem,
    TypeHierarchyProvider,
} from "../../../../editor/common/languages/iTypeHierarchySource.ts";

import { TypesModel } from "./typeHierarchyModel.ts";

function item(itemId: number, name: string, uri = "file:///a.go", line = 0): ITypeHierarchyItem {
    const range = createRange(line, 3, line, 6);
    return { itemId, name, kind: 10, uri, range, selectionRange: range };
}

function provider(overrides: Partial<TypeHierarchyProvider> = {}): TypeHierarchyProvider {
    return {
        prepareTypeHierarchy: () => Promise.resolve(null),
        provideSupertypes: vi.fn(() => Promise.resolve([])),
        provideSubtypes: vi.fn(() => Promise.resolve([])),
        releaseTypeHierarchy: vi.fn(),
        ...overrides,
    };
}

describe("TypesModel", () => {
    it("subtypes: asks by session and item, once, and keeps the answer in the node", async () => {
        const fake = provider({ provideSubtypes: vi.fn(() => Promise.resolve([item(2, "Circle")])) });
        const model = new TypesModel(fake, 7, "subtypes", [item(1, "Shape")], CancellationTokenNone);
        const [root] = model.roots;

        const [first, second] = await Promise.all([model.getChildren(root), model.getChildren(root)]);

        expect(first.map((node) => node.item.name)).toEqual(["Circle"]);
        expect(second).toBe(first);
        expect(fake.provideSubtypes).toHaveBeenCalledTimes(1);
        expect(fake.provideSubtypes).toHaveBeenCalledWith(7, 1, CancellationTokenNone);
        expect(fake.provideSupertypes).not.toHaveBeenCalled();
    });

    it("supertypes: asks the other direction", async () => {
        const fake = provider({ provideSupertypes: vi.fn(() => Promise.resolve([item(2, "Base")])) });
        const model = new TypesModel(fake, 7, "supertypes", [item(1, "Shape")], CancellationTokenNone);

        const children = await model.getChildren(model.roots[0]);

        expect(children.map((node) => node.item.name)).toEqual(["Base"]);
        expect(fake.provideSupertypes).toHaveBeenCalledWith(7, 1, CancellationTokenNone);
        expect(fake.provideSubtypes).not.toHaveBeenCalled();
    });

    it("sorts children by uri and then by the start of the range", async () => {
        const fake = provider({
            provideSubtypes: () =>
                Promise.resolve([
                    item(2, "b late", "file:///b.go", 9),
                    item(3, "a late", "file:///a.go", 5),
                    item(4, "b early", "file:///b.go", 1),
                    item(5, "a early", "file:///a.go", 2),
                ]),
        });
        const model = new TypesModel(fake, 1, "subtypes", [item(1, "Shape")], CancellationTokenNone);
        const children = await model.getChildren(model.roots[0]);
        expect(children.map((node) => node.item.name)).toEqual(["a early", "a late", "b early", "b late"]);
    });
});
