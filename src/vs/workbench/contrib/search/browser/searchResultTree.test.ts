import { describe, expect, it } from "vitest";

import { buildSearchTree, type SearchTreeNode } from "./searchResultTree.ts";

interface Item {
    readonly relPath: string;
}

function item(relPath: string): Item {
    return { relPath };
}

function dump(nodes: readonly SearchTreeNode<Item>[], indent = ""): string[] {
    return nodes.flatMap((node) =>
        node.kind === "folder"
            ? [`${indent}${node.label}/`, ...dump(node.children, indent + "  ")]
            : [`${indent}${node.name}`],
    );
}

describe("buildSearchTree", () => {
    it("files at the root are leaves without folders", () => {
        expect(dump(buildSearchTree([item("b.ts"), item("a.ts")]))).toEqual(["a.ts", "b.ts"]);
    });

    it("builds a hierarchy: folders before files, alphabetical within groups", () => {
        const nodes = buildSearchTree([item("z.ts"), item("src/y/b.ts"), item("src/x/a.ts"), item("src/root.ts")]);
        expect(dump(nodes)).toEqual(["src/", "  x/", "    a.ts", "  y/", "    b.ts", "  root.ts", "z.ts"]);
    });

    it("single-child folder chains are compacted into one node with the full path", () => {
        const nodes = buildSearchTree([item("deep/nested/dir/c.ts")]);
        expect(dump(nodes)).toEqual(["deep/nested/dir/", "  c.ts"]);
        const folder = nodes[0];
        expect(folder.kind).toBe("folder");
        if (folder.kind === "folder") {
            expect(folder.path).toBe("deep/nested/dir");
            expect(folder.label).toBe("deep/nested/dir");
        }
    });

    it("a file inside the chain stops compaction", () => {
        const nodes = buildSearchTree([item("a/b/c/x.ts"), item("a/b/y.ts")]);
        expect(dump(nodes)).toEqual(["a/b/", "  c/", "    x.ts", "  y.ts"]);
    });

    it("a new file splits a compacted chain on rebuild", () => {
        const before = buildSearchTree([item("a/b/c/x.ts")]);
        expect(dump(before)).toEqual(["a/b/c/", "  x.ts"]);

        const after = buildSearchTree([item("a/b/c/x.ts"), item("a/d/y.ts")]);
        expect(dump(after)).toEqual(["a/", "  b/c/", "    x.ts", "  d/", "    y.ts"]);
    });

    it("the path of nested folders includes the parent prefix", () => {
        const nodes = buildSearchTree([item("a/b/x.ts"), item("a/c/y.ts")]);
        const a = nodes[0];
        if (a.kind !== "folder") throw new Error("expected a folder");
        expect(a.path).toBe("a");
        const [b, c] = a.children;
        if (b.kind !== "folder" || c.kind !== "folder") throw new Error("expected folders");
        expect(b.path).toBe("a/b");
        expect(c.path).toBe("a/c");
    });
});
