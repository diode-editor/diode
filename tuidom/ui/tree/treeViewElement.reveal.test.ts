import { describe, expect, it } from "vitest";

import { TestApp } from "../../testing/TestApp.ts";
import { Size } from "../../common/geometryPromitives.ts";

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
            return { label: element.label, collapsible: (element.children?.length ?? 0) > 0 };
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

const FLAT_TREE: TestNode[] = [
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" },
    { id: "c", label: "Gamma" },
];

const NESTED_TREE: TestNode[] = [
    {
        id: "src",
        label: "src",
        children: [
            {
                id: "src/utils",
                label: "utils",
                children: [{ id: "src/utils/helper.ts", label: "helper.ts" }],
            },
            { id: "src/main.ts", label: "main.ts" },
        ],
    },
    { id: "README.md", label: "README.md" },
];

function createTree(
    roots: TestNode[],
    viewportSize: Size = new Size(40, 10),
): { tree: TreeViewElement<TestNode>; app: TestApp } {
    const tree = new TreeViewElement(createProvider(roots));
    const app = TestApp.createWithContent(tree, viewportSize);
    tree.focus();
    return { tree, app };
}

describe("TreeViewElement — reveal", () => {
    it("expands each ancestor and selects the nested target", async () => {
        const { tree, app } = createTree(NESTED_TREE);
        await tree.refresh();
        app.render();
        expect(app.backend.screenToString()).not.toContain("helper.ts");

        const src = NESTED_TREE[0];
        const utils = src.children![0];
        const helper = utils.children![0];
        await tree.reveal([src, utils, helper]);
        app.render();

        const output = app.backend.screenToString();
        expect(output).toContain("utils");
        expect(output).toContain("helper.ts");
        expect(tree.getSelectedNode()?.id).toBe("src/utils/helper.ts");
    });

    it("fires onExpandedChanged for each newly expanded ancestor", async () => {
        const { tree } = createTree(NESTED_TREE);
        await tree.refresh();

        const expanded: string[] = [];
        tree.onExpandedChanged = (node, isExpanded) => {
            if (isExpanded) expanded.push(node.id);
        };

        const src = NESTED_TREE[0];
        const utils = src.children![0];
        const helper = utils.children![0];
        await tree.reveal([src, utils, helper]);

        expect(expanded).toEqual(["src", "src/utils"]);
    });

    it("selects an already-visible root target", async () => {
        const { tree } = createTree(FLAT_TREE);
        await tree.refresh();

        await tree.reveal([FLAT_TREE[2]]);
        expect(tree.getSelectedNode()?.id).toBe("c");
    });

    it("no-ops on an empty chain", async () => {
        const { tree } = createTree(FLAT_TREE);
        await tree.refresh();
        const before = tree.getSelectedNode()?.id;

        await tree.reveal([]);
        expect(tree.getSelectedNode()?.id).toBe(before);
    });

    it("leaves the selection unchanged when the target is absent after expansion", async () => {
        const { tree } = createTree(NESTED_TREE);
        await tree.refresh();

        const src = NESTED_TREE[0];
        const ghost: TestNode = { id: "src/ghost.ts", label: "ghost.ts" };
        await tree.reveal([src, ghost]);

        // src was expanded, but the ghost target isn't a real child → cursor stays at src.
        expect(tree.getSelectedNode()?.id).toBe("src");
    });

    it("skips ancestors that are already expanded", async () => {
        const { tree } = createTree(NESTED_TREE);
        await tree.refresh();
        const src = NESTED_TREE[0];
        const utils = src.children![0];
        const helper = utils.children![0];

        // Pre-expand src, then reveal through it — expandElement short-circuits on src.
        await tree.toggleExpand(src);
        await tree.reveal([src, utils, helper]);

        expect(tree.getSelectedNode()?.id).toBe("src/utils/helper.ts");
    });

    it("re-expands a collapsed ancestor from cache without reloading children", async () => {
        const { tree } = createTree(NESTED_TREE);
        await tree.refresh();
        const src = NESTED_TREE[0];
        const utils = src.children![0];
        const helper = utils.children![0];

        // Expand then collapse src: its children stay cached, but it is no longer expanded.
        await tree.toggleExpand(src);
        await tree.toggleExpand(src);

        await tree.reveal([src, utils, helper]);
        expect(tree.getSelectedNode()?.id).toBe("src/utils/helper.ts");
    });

    it("scrolls a target below the fold into view", async () => {
        const many: TestNode[] = Array.from({ length: 40 }, (_v, i) => ({ id: `n${i}`, label: `node-${i}` }));
        const { tree, app } = createTree(many, new Size(40, 8));
        await tree.refresh();
        app.render();
        expect(app.backend.screenToString()).not.toContain("node-39");

        await tree.reveal([many[39]]);
        app.render();

        expect(app.backend.screenToString()).toContain("node-39");
        expect(tree.getSelectedNode()?.id).toBe("n39");
    });
});
