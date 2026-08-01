import { describe, expect, it } from "vitest";

import { expectScreen, screen } from "../../../src/TestUtils/expectScreen.ts";
import { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { packRgb } from "../../common/colorUtils.ts";
import { BoxConstraints, Offset, Point, Rect, Size } from "../../common/geometryPromitives.ts";
import { STYLE_TOKEN_DEFAULTS } from "../../dom/styles/styleTokens.ts";
import { ROOT_STYLE_CONTEXT } from "../../dom/styles/tuiStyle.ts";
import { RenderContext } from "../../dom/tuiElement.ts";
import { TerminalScreen } from "../../rendering/terminalScreen.ts";

import type { ITreeDataProvider, ITreeItem } from "./iTreeDataProvider.ts";
import { TreeViewElement } from "./treeViewElement.ts";

interface TestNode {
    id: string;
    label: string;
    children?: TestNode[];
}

function createProvider(roots: TestNode[]): ITreeDataProvider<TestNode> {
    return {
        getTreeItem(element: TestNode): ITreeItem {
            return {
                label: element.label,
                collapsible: (element.children?.length ?? 0) > 0,
            };
        },
        getChildren(element?: TestNode): TestNode[] {
            if (!element) return roots;
            return element.children ?? [];
        },
        getKey(element: TestNode): string {
            return element.id;
        },
    };
}

function renderTree(tree: TreeViewElement<TestNode>, width: number, height: number): MockTerminalBackend {
    const size = new Size(width, height);
    const backend = new MockTerminalBackend(size);
    const termScreen = new TerminalScreen(size);
    tree.localPosition = new Offset(0, 0);
    tree.layout(BoxConstraints.tight(size));
    tree.performStyleResolution(ROOT_STYLE_CONTEXT);
    const clipRect = new Rect(new Point(0, 0), size);
    tree.render(new RenderContext(termScreen, new Offset(0, 0), clipRect));
    termScreen.flush(backend);
    return backend;
}

describe("TreeViewElement rendering", () => {
    it("renders flat list of items", async () => {
        const roots: TestNode[] = [
            { id: "a", label: "Alpha" },
            { id: "b", label: "Beta" },
            { id: "c", label: "Gamma" },
        ];
        const tree = new TreeViewElement(createProvider(roots));
        await tree.refresh();

        const backend = renderTree(tree, 12, 3);
        // Each row: expandIcon(" ") + " " + label
        const actual = backend
            .screenToString()
            .split("\n")
            .map((l) => l.trimEnd());
        expect(actual[0]).toBe("  Alpha");
        expect(actual[1]).toBe("  Beta");
        expect(actual[2]).toBe("  Gamma");
    });

    it("renders collapsible items with collapsed icon", async () => {
        const roots: TestNode[] = [
            { id: "dir", label: "src", children: [{ id: "f", label: "main.ts" }] },
            { id: "readme", label: "README.md" },
        ];
        const tree = new TreeViewElement(createProvider(roots));
        await tree.refresh();

        const backend = renderTree(tree, 14, 2);
        //  = collapsed icon for collapsible, space for non-collapsible
        expectScreen(
            backend,
            screen`
                \uF105 src
                  README.md
            `,
        );
    });

    it("renders expanded items with children indented", async () => {
        const roots: TestNode[] = [
            {
                id: "dir",
                label: "src",
                children: [
                    { id: "f1", label: "main.ts" },
                    { id: "f2", label: "util.ts" },
                ],
            },
        ];
        const tree = new TreeViewElement(createProvider(roots));
        await tree.refresh();
        await tree.toggleExpand(roots[0]);

        const backend = renderTree(tree, 16, 3);
        //  = expanded icon, children indented by 2
        expectScreen(
            backend,
            screen`
                \uF107 src
                    main.ts
                    util.ts
            `,
        );
    });

    it("renders deeply nested expanded tree", async () => {
        const roots: TestNode[] = [
            {
                id: "a",
                label: "root",
                children: [
                    {
                        id: "b",
                        label: "mid",
                        children: [{ id: "c", label: "leaf" }],
                    },
                ],
            },
        ];
        const tree = new TreeViewElement(createProvider(roots));
        await tree.refresh();
        await tree.toggleExpand(roots[0]);
        await tree.toggleExpand(roots[0].children![0]);

        const backend = renderTree(tree, 16, 3);
        expectScreen(
            backend,
            screen`
                \uF107 root
                  \uF107 mid
                      leaf
            `,
        );
    });

    it("renders empty lines below content", async () => {
        const roots: TestNode[] = [{ id: "a", label: "One" }];
        const tree = new TreeViewElement(createProvider(roots));
        await tree.refresh();

        const backend = renderTree(tree, 8, 3);
        // One row of content, 2 empty rows
        const lines = backend.screenToString().split("\n");
        // First line has content
        expect(lines[0]).toContain("One");
    });

    it("renders a right-edge grey arrow badge for symlinks without hiding the type icon", async () => {
        const provider: ITreeDataProvider<TestNode> = {
            getTreeItem: (el) => ({
                label: el.label,
                icon: "",
                iconColor: 0xffffff,
                collapsible: false,
                symlink: el.id === "link",
            }),
            getChildren: (el) =>
                el
                    ? []
                    : [
                          { id: "plain", label: "a.ts" },
                          { id: "link", label: "b.ts" },
                      ],
            getKey: (el) => el.id,
        };
        const tree = new TreeViewElement(provider);
        tree.setStyleVars({ "list.deemphasizedForeground": packRgb(120, 120, 120) });
        await tree.refresh();

        const width = 14;
        const backend = renderTree(tree, width, 2);
        const lines = backend.screenToString().split("\n");
        // Plain file: no badge anywhere on the row.
        expect(lines[0]).not.toContain("↵");
        expect(lines[0]).toContain("");
        // Symlink: arrow pinned to the rightmost column, type icon and label preserved.
        expect(lines[1][width - 1]).toBe("↵");
        expect(lines[1]).toContain("");
        expect(lines[1]).toContain("b.ts");
        // The badge is rendered in the (grey) symlink foreground colour.
        expect(backend.getFgAt(new Point(width - 1, 1))).toBe(packRgb(120, 120, 120));
    });

    it("shifts row content by leftPadding while the cursor background reaches the left edge", async () => {
        const roots: TestNode[] = [
            { id: "a", label: "Alpha" },
            { id: "b", label: "Beta" },
        ];
        const tree = new TreeViewElement(createProvider(roots), { leftPadding: 1 });
        await tree.refresh();

        const backend = renderTree(tree, 12, 2);
        const actual = backend
            .screenToString()
            .split("\n")
            .map((l) => l.trimEnd());
        // padding(1) + expandIcon slot(" ") + " " + label
        expect(actual[0]).toBe("   Alpha");
        expect(actual[1]).toBe("   Beta");
        // Cursor row (unfocused → inactive selection) is filled from the very first column.
        expect(backend.getBgAt(new Point(0, 0))).toBe(STYLE_TOKEN_DEFAULTS["list.inactiveSelectionBackground"]);
        expect(backend.getBgAt(new Point(0, 1))).not.toBe(STYLE_TOKEN_DEFAULTS["list.inactiveSelectionBackground"]);
    });

    it("renders with scroll offset", async () => {
        const roots: TestNode[] = [];
        for (let i = 0; i < 10; i++) {
            roots.push({ id: String(i), label: `Item${String(i)}` });
        }
        const tree = new TreeViewElement(createProvider(roots));
        await tree.refresh();

        // Layout first so scrollTo can clamp properly
        const size = new Size(12, 3);
        tree.localPosition = new Offset(0, 0);
        tree.layout(BoxConstraints.tight(size));
        tree.scrollTo(0, 5);

        const backend = new MockTerminalBackend(size);
        const termScreen = new TerminalScreen(size);
        const clipRect = new Rect(new Point(0, 0), size);
        tree.render(new RenderContext(termScreen, new Offset(0, 0), clipRect));
        termScreen.flush(backend);

        // Each row: expandIcon(" ") + " " + label
        const actual = backend
            .screenToString()
            .split("\n")
            .map((l) => l.trimEnd());
        expect(actual[0]).toBe("  Item5");
        expect(actual[1]).toBe("  Item6");
        expect(actual[2]).toBe("  Item7");
    });
});
