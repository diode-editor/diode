import { describe, expect, it } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";

import type { IScmChange } from "./changesService.ts";
import { buildScmTree, displayPath, type IScmTreeFolder, sortChangesFlat } from "./scmChangeTree.ts";

function change(path: string, overrides: Partial<IScmChange> = {}): IScmChange {
    return {
        uri: Uri.file(`/repo/${path === "" ? "unknown.txt" : path}`),
        status: "M",
        colorId: "gitDecoration.modifiedResourceForeground",
        path,
        group: "worktree",
        ...overrides,
    };
}

function labels(nodes: readonly ReturnType<typeof buildScmTree>[number][]): string[] {
    return nodes.map((n) => (n.kind === "folder" ? `${n.label}/` : n.name));
}

describe("scmChangeTree — displayPath / sortChangesFlat", () => {
    it("uses the git-relative path when present and basename otherwise", () => {
        expect(displayPath(change("src/a.ts"))).toBe("src/a.ts");
        expect(displayPath(change(""))).toBe("unknown.txt");
    });

    it("flat order sorts by display path (localeCompare), matching the old provider", () => {
        const flat = sortChangesFlat([change("zeta.ts"), change("src/b.ts"), change("alpha.ts")]);
        expect(flat.map(displayPath)).toEqual(["alpha.ts", "src/b.ts", "zeta.ts"]);
    });
});

describe("scmChangeTree — buildScmTree", () => {
    it("puts root files at the top level", () => {
        const tree = buildScmTree([change("a.txt")]);
        expect(tree).toHaveLength(1);
        expect(tree[0]).toMatchObject({ kind: "file", name: "a.txt" });
    });

    it("nests files under their folders", () => {
        const tree = buildScmTree([change("src/a.ts"), change("root.txt")]);
        expect(labels(tree)).toEqual(["src/", "root.txt"]);
        const src = tree[0] as IScmTreeFolder;
        expect(labels(src.children)).toEqual(["a.ts"]);
    });

    it("compacts single-child folder chains into one node", () => {
        const tree = buildScmTree([change("src/vs/workbench/a.ts")]);
        expect(tree).toHaveLength(1);
        const folder = tree[0] as IScmTreeFolder;
        expect(folder.label).toBe("src/vs/workbench");
        expect(folder.path).toBe("src/vs/workbench");
        expect(labels(folder.children)).toEqual(["a.ts"]);
    });

    it("does not compact past a folder that contains a file", () => {
        const tree = buildScmTree([change("src/vs/a.ts"), change("src/vs/workbench/b.ts")]);
        const srcVs = tree[0] as IScmTreeFolder;
        expect(srcVs.label).toBe("src/vs");
        // Внутри: папка workbench раньше файла a.ts.
        expect(labels(srcVs.children)).toEqual(["workbench/", "a.ts"]);
    });

    it("does not compact below a branching point", () => {
        const tree = buildScmTree([change("src/one/a.ts"), change("src/two/b.ts")]);
        const src = tree[0] as IScmTreeFolder;
        expect(src.label).toBe("src");
        expect(labels(src.children)).toEqual(["one/", "two/"]);
        expect((src.children[0] as IScmTreeFolder).path).toBe("src/one");
    });

    it("orders folders before files, alphabetically within each group", () => {
        const tree = buildScmTree([change("b.txt"), change("a.txt"), change("zdir/c.txt"), change("adir/d.txt")]);
        expect(labels(tree)).toEqual(["adir/", "zdir/", "a.txt", "b.txt"]);
    });

    it("falls back to basename at the root for changes without a path", () => {
        const tree = buildScmTree([change("")]);
        expect(tree[0]).toMatchObject({ kind: "file", name: "unknown.txt" });
    });
});
