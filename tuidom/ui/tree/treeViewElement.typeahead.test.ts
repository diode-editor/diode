import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TestApp } from "../../testing/TestApp.ts";
import { Size } from "../../common/geometryPromitives.ts";

import type { ITreeDataProvider, ITreeItem } from "./iTreeDataProvider.ts";
import { TreeViewElement } from "./treeViewElement.ts";

// ─── Test data ───

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

function createTree(
    roots: TestNode[],
    viewportSize: Size = new Size(40, 10),
): { tree: TreeViewElement<TestNode>; app: TestApp } {
    const provider = createProvider(roots);
    const tree = new TreeViewElement(provider);
    const app = TestApp.createWithContent(tree, viewportSize);
    tree.focus();
    return { tree, app };
}

const FILES: TestNode[] = [
    { id: "a", label: "app.ts" },
    { id: "b", label: "build.sh" },
    { id: "c", label: "index.ts" },
    { id: "d", label: "README.md" },
    { id: "e", label: "readme.txt" },
    { id: "f", label: "server.ts" },
];

// ─── Tests ───

describe("TreeViewElement type-ahead", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    async function setup(roots = FILES): Promise<{ tree: TreeViewElement<TestNode>; app: TestApp }> {
        const { tree, app } = createTree(roots);
        await tree.refresh();
        app.render();
        return { tree, app };
    }

    it("jumps the cursor to the first file starting with the typed letter", async () => {
        const { tree, app } = await setup();

        app.sendKey("i");

        expect(tree.getSelectedNode()?.label).toBe("index.ts");
    });

    it("refines the match as more distinct characters are typed", async () => {
        const { tree, app } = await setup([
            { id: "1", label: "sample.js" },
            { id: "2", label: "server.ts" },
            { id: "3", label: "session.log" },
        ]);

        app.sendKey("s"); // sample.js (first s-file)
        expect(tree.getSelectedNode()?.label).toBe("sample.js");

        // "se" moves past sample.js to the next file starting with "se"
        app.sendKey("e");
        expect(tree.getSelectedNode()?.label).toBe("server.ts");
    });

    it("matches case-insensitively", async () => {
        const { tree, app } = await setup();

        app.sendKey("R");
        expect(tree.getSelectedNode()?.label).toBe("README.md");
    });

    it("cycles through matches when the same letter is pressed repeatedly", async () => {
        const { tree, app } = await setup();

        app.sendKey("r"); // README.md (first r-file)
        expect(tree.getSelectedNode()?.label).toBe("README.md");

        app.sendKey("r"); // readme.txt (next r-file)
        expect(tree.getSelectedNode()?.label).toBe("readme.txt");

        app.sendKey("r"); // wraps back to README.md
        expect(tree.getSelectedNode()?.label).toBe("README.md");
    });

    it("resets the buffer after the timeout so a later key starts a fresh search", async () => {
        const { tree, app } = await setup();

        app.sendKey("s"); // server.ts
        expect(tree.getSelectedNode()?.label).toBe("server.ts");

        vi.advanceTimersByTime(1000);

        // Fresh search: "a" should find app.ts, not continue the "s" prefix.
        app.sendKey("a");
        expect(tree.getSelectedNode()?.label).toBe("app.ts");
    });

    it("does nothing when no label matches", async () => {
        const { tree, app } = await setup();

        app.sendKey("i"); // index.ts
        expect(tree.getSelectedNode()?.label).toBe("index.ts");

        app.sendKey("z"); // no match — cursor stays put
        expect(tree.getSelectedNode()?.label).toBe("index.ts");
    });

    it("ignores keystrokes with modifier keys held", async () => {
        const { tree, app } = await setup();

        // cursor starts at the first row
        expect(tree.getSelectedNode()?.label).toBe("app.ts");

        app.sendKey("Ctrl+s"); // must not trigger a jump to server.ts
        expect(tree.getSelectedNode()?.label).toBe("app.ts");
    });

    it("does nothing when the tree is empty", async () => {
        const { tree, app } = await setup([]);

        expect(tree.contentHeight).toBe(0);
        app.sendKey("a"); // must not throw or select anything
        expect(tree.getSelectedNode()).toBeNull();
    });

    it("does not treat space as a search character", async () => {
        const { tree, app } = await setup([
            { id: "x", label: "src", children: [{ id: "x/main.ts", label: "main.ts" }] },
        ]);

        // Space toggles expansion on a collapsible node rather than searching.
        expect(tree.contentHeight).toBe(1);
        app.sendKey(" ");
        await vi.advanceTimersByTimeAsync(1); // toggleExpand awaits a microtask
        expect(tree.contentHeight).toBe(2);
    });
});
