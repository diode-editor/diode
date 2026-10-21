import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { describe, expect, it } from "vitest";

import { getFileIcon } from "../../../../base/common/fileIcons.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { WorkspaceContextService } from "../../../../platform/workspace/common/workspaceContextService.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";

import type { IOpenEditorsSource } from "./openEditorsQuickAccessProvider.ts";
import { OpenEditorsQuickAccessProvider } from "./openEditorsQuickAccessProvider.ts";

const ROOT = "/repo";

function makePane(
    uriPath: string,
    { modified = false, label }: { modified?: boolean; label?: string } = {},
): IEditorPane {
    return {
        uri: Uri.file(uriPath),
        label: label ?? uriPath.split("/").pop() ?? uriPath,
        view: {} as TUIElement,
        isModified: modified,
        readOnly: false,
        getSelectedTexts: () => [],
        onDidChangeState: (): IDisposable => ({ dispose: () => undefined }),
        focusEditor: () => undefined,
        dispose: () => undefined,
    };
}

function makeUntitledPane(name: string): IEditorPane {
    return { ...makePane(`/${name}`), uri: Uri.parse(`untitled:${name}`), label: name };
}

interface Harness {
    provider: OpenEditorsQuickAccessProvider;
    revealed: IEditorPane[];
}

function createProvider(panes: IEditorPane[], root: string | null = ROOT): Harness {
    const revealed: IEditorPane[] = [];
    const editors: IOpenEditorsSource = {
        getOpenEditorsMru: () => panes,
        displayName: (editor) => editor.label,
        revealPane: (editor) => revealed.push(editor),
    };
    // A real WorkspaceContextService: the picker asks it for the tab uri's folder,
    // and a stub would test its own prefix match instead of the real one.
    const workspace = new WorkspaceContextService();
    if (root !== null) workspace.setWorkspaceFolder(root);
    return { provider: new OpenEditorsQuickAccessProvider(editors, workspace), revealed };
}

function query(filter: string): string {
    return OpenEditorsQuickAccessProvider.PREFIX + filter;
}

describe("OpenEditorsQuickAccessProvider — list and order", () => {
    it("the prefix is `edt ` with a space, as in vscode", () => {
        expect(OpenEditorsQuickAccessProvider.PREFIX).toBe("edt ");
    });

    it("the placeholder is the open editors picker title", () => {
        const { provider } = createProvider([]);
        expect(provider.getPlaceholder()).toBe("Show All Opened Editors");
    });

    it("an empty query returns all tabs in the source's MRU order", () => {
        const { provider } = createProvider([
            makePane(`${ROOT}/src/index.ts`),
            makePane(`${ROOT}/readme.md`),
            makePane(`${ROOT}/src/vs/editor/core.ts`),
        ]);

        const items = provider.getItems(query(""));

        expect(items.map((item) => item.label)).toEqual(["index.ts", "readme.md", "core.ts"]);
    });

    it("the description is the path relative to the workspace root; empty for a file at the root", () => {
        const { provider } = createProvider([makePane(`${ROOT}/src/vs/editor/core.ts`), makePane(`${ROOT}/readme.md`)]);

        expect(provider.getItems(query("")).map((item) => item.description)).toEqual(["src/vs/editor", ""]);
    });

    it("a file outside the root is shown with an absolute path, not a chain of `..`", () => {
        const { provider } = createProvider([makePane("/etc/hosts")]);

        expect(provider.getItems(query(""))[0].description).toBe("/etc");
    });

    it("without a workspace root the description is the absolute path", () => {
        const { provider } = createProvider([makePane(`${ROOT}/src/index.ts`)], null);

        expect(provider.getItems(query(""))[0].description).toBe("/repo/src");
    });

    it("an untitled buffer has no description (and no path on disk)", () => {
        const { provider } = createProvider([makeUntitledPane("Untitled-1")]);

        const [item] = provider.getItems(query(""));
        expect(item.label).toBe("Untitled-1");
        expect(item.description).toBe("");
    });

    it("no open tabs — a single info row, nothing to accept", () => {
        const { provider } = createProvider([]);

        const items = provider.getItems(query(""));

        expect(items).toHaveLength(1);
        expect(items[0].label).toBe("No opened editors");
        expect(items[0].accept).toBeUndefined();
    });

    it("each row has its file type's icon — the list reads like the tab bar", () => {
        const { provider } = createProvider([makePane(`${ROOT}/src/index.ts`), makePane(`${ROOT}/readme.md`)]);

        expect(provider.getItems(query("")).map((item) => item.icon)).toEqual([
            getFileIcon("index.ts").icon,
            getFileIcon("readme.md").icon,
        ]);
    });
});

describe("OpenEditorsQuickAccessProvider — filtering", () => {
    function threeFiles(): Harness {
        return createProvider([
            makePane(`${ROOT}/src/index.ts`),
            makePane(`${ROOT}/readme.md`),
            makePane(`${ROOT}/src/vs/editor/core.ts`),
        ]);
    }

    it("fuzzy on the file name keeps only the matches", () => {
        const { provider } = threeFiles();

        expect(provider.getItems(query("cor")).map((item) => item.label)).toEqual(["core.ts"]);
    });

    it("fuzzy on the directory finds a tab whose name does not match the query", () => {
        const { provider } = threeFiles();

        expect(provider.getItems(query("editor")).map((item) => item.label)).toEqual(["core.ts"]);
    });

    it("a match in the name beats a match only in the path", () => {
        const { provider } = createProvider([
            // `src` is in both paths, but only the second matches by name.
            makePane(`${ROOT}/src/index.ts`),
            makePane(`${ROOT}/src/srv.ts`),
        ]);

        expect(provider.getItems(query("sr")).map((item) => item.label)).toEqual(["srv.ts", "index.ts"]);
    });

    it("nothing matched — an empty list", () => {
        const { provider } = threeFiles();

        expect(provider.getItems(query("zzz"))).toEqual([]);
    });

    it("matched name letters are highlighted in the label, not in the description", () => {
        const { provider } = threeFiles();

        const [item] = provider.getItems(query("cor"));
        expect(item.labelMatchRanges).toEqual([[0, 3]]);
        expect(item.descriptionMatchRanges).toEqual([]);
    });

    it("a directory match is highlighted in the description with local offsets", () => {
        const { provider } = threeFiles();

        const [item] = provider.getItems(query("editor"));
        expect(item.description).toBe("src/vs/editor");
        expect(item.descriptionMatchRanges).toEqual([[7, 13]]);
        expect(item.labelMatchRanges).toEqual([]);
    });

    it("a file at the root has no path — a query with a slash does not find it", () => {
        const { provider } = threeFiles();

        // readme.md is at the root: its search text has neither a directory nor a slash,
        // otherwise "/" would match everything open.
        expect(provider.getItems(query("/")).map((item) => item.label)).toEqual(["index.ts", "core.ts"]);
    });

    it("extra spaces around the query do not reach fuzzy", () => {
        const { provider } = threeFiles();

        expect(provider.getItems(`${OpenEditorsQuickAccessProvider.PREFIX}  cor  `).map((i) => i.label)).toEqual([
            "core.ts",
        ]);
    });
});

describe("OpenEditorsQuickAccessProvider — multi-term query", () => {
    it("`edt ` stays a working prefix: it is stripped BEFORE splitting on spaces", () => {
        // Parsing the whole query would leave `edt` as a separate term that
        // no tab matches.
        const { provider } = createProvider([makePane(`${ROOT}/src/index.ts`)]);

        expect(provider.getItems(query("")).map((item) => item.label)).toEqual(["index.ts"]);
    });

    it("terms match on the directory and the name at once", () => {
        const { provider } = createProvider([
            makePane(`${ROOT}/src/editor/core.ts`),
            makePane(`${ROOT}/lib/editor/core.ts`),
            makePane(`${ROOT}/src/main.ts`),
        ]);

        expect(provider.getItems(query("src core")).map((item) => item.label)).toEqual(["core.ts"]);
    });

    it("all terms must be found", () => {
        const { provider } = createProvider([makePane(`${ROOT}/src/core.ts`)]);

        expect(provider.getItems(query("src zebra"))).toEqual([]);
    });

    it("repeated spaces and a trailing space do not change the results", () => {
        const { provider } = createProvider([makePane(`${ROOT}/src/core.ts`), makePane(`${ROOT}/lib/main.ts`)]);

        for (const filter of ["src core", "src  core", "src core "]) {
            expect(
                provider.getItems(query(filter)).map((item) => item.label),
                filter,
            ).toEqual(["core.ts"]);
        }
    });

    it("highlights are split between both halves of the row, one part per term", () => {
        const { provider } = createProvider([makePane(`${ROOT}/src/core.ts`)]);

        const [item] = provider.getItems(query("src core"));
        expect(item.description).toBe("src");
        expect(item.descriptionMatchRanges).toEqual([[0, 3]]);
        expect(item.labelMatchRanges).toEqual([[0, 4]]);
    });
});

describe("OpenEditorsQuickAccessProvider — row and accept", () => {
    it("a dirty tab is marked with a dot, a saved one is not", () => {
        const { provider } = createProvider([makePane(`${ROOT}/a.ts`, { modified: true }), makePane(`${ROOT}/b.ts`)]);

        expect(provider.getItems(query("")).map((item) => item.hint)).toEqual(["●", undefined]);
    });

    it("accepting a row shows its tab", () => {
        const panes = [makePane(`${ROOT}/a.ts`), makePane(`${ROOT}/b.ts`)];
        const { provider, revealed } = createProvider(panes);

        provider.getItems(query("b"))[0].accept?.();

        expect(revealed).toEqual([panes[1]]);
    });
});
