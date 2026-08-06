import { describe, expect, it } from "vitest";

import { buildSearchTree, type SearchTreeNode } from "./searchResultTree.ts";

interface Item {
    readonly relPath: string;
}

function item(relPath: string): Item {
    return { relPath };
}

/** Компактная текстовая форма дерева для наглядных ассертов. */
function dump(nodes: readonly SearchTreeNode<Item>[], indent = ""): string[] {
    return nodes.flatMap((node) =>
        node.kind === "folder"
            ? [`${indent}${node.label}/`, ...dump(node.children, indent + "  ")]
            : [`${indent}${node.name}`],
    );
}

describe("buildSearchTree", () => {
    it("файлы в корне — листья без папок", () => {
        expect(dump(buildSearchTree([item("b.ts"), item("a.ts")]))).toEqual(["a.ts", "b.ts"]);
    });

    it("строит иерархию: папки раньше файлов, внутри групп — по алфавиту", () => {
        const nodes = buildSearchTree([item("z.ts"), item("src/y/b.ts"), item("src/x/a.ts"), item("src/root.ts")]);
        expect(dump(nodes)).toEqual(["src/", "  x/", "    a.ts", "  y/", "    b.ts", "  root.ts", "z.ts"]);
    });

    it("одиночные цепочки папок компактируются в один узел с полным path", () => {
        const nodes = buildSearchTree([item("deep/nested/dir/c.ts")]);
        expect(dump(nodes)).toEqual(["deep/nested/dir/", "  c.ts"]);
        const folder = nodes[0];
        expect(folder.kind).toBe("folder");
        if (folder.kind === "folder") {
            expect(folder.path).toBe("deep/nested/dir");
            expect(folder.label).toBe("deep/nested/dir");
        }
    });

    it("файл внутри цепочки останавливает компакцию", () => {
        const nodes = buildSearchTree([item("a/b/c/x.ts"), item("a/b/y.ts")]);
        expect(dump(nodes)).toEqual(["a/b/", "  c/", "    x.ts", "  y.ts"]);
    });

    it("новый файл раскалывает компакт-цепочку при пересборке", () => {
        const before = buildSearchTree([item("a/b/c/x.ts")]);
        expect(dump(before)).toEqual(["a/b/c/", "  x.ts"]);

        const after = buildSearchTree([item("a/b/c/x.ts"), item("a/d/y.ts")]);
        expect(dump(after)).toEqual(["a/", "  b/c/", "    x.ts", "  d/", "    y.ts"]);
    });

    it("path вложенных папок включает префикс родителя", () => {
        const nodes = buildSearchTree([item("a/b/x.ts"), item("a/c/y.ts")]);
        const a = nodes[0];
        if (a.kind !== "folder") throw new Error("ожидалась папка");
        expect(a.path).toBe("a");
        const [b, c] = a.children;
        if (b.kind !== "folder" || c.kind !== "folder") throw new Error("ожидались папки");
        expect(b.path).toBe("a/b");
        expect(c.path).toBe("a/c");
    });
});
