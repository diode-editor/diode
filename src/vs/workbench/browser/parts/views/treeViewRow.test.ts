import { Size } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import type { ITreeDataProvider, ITreeItem } from "@tuidom/elements/tree/iTreeDataProvider";
import { TreeViewElement } from "@tuidom/elements/tree/treeViewElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";

// Row capabilities of @tuidom TreeViewElement that the extension TreeView chain (#821) builds on:
// ITreeItem.description and ITreeItem.actions, seen through the rendered frame.

interface Node {
    id: string;
    item: ITreeItem;
}

function provider(items: Node[]): ITreeDataProvider<Node> {
    return {
        getTreeItem: (el) => el.item,
        getChildren: (el) => (el ? [] : items),
        getKey: (el) => el.id,
    };
}

function mouse(x: number, y: number, action: MouseToken["action"]): MouseToken {
    const button = action === "move" ? "none" : "left";
    return {
        kind: "mouse",
        button,
        x: x + 1,
        y: y + 1,
        action,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    };
}

async function mount(items: Node[], width: number) {
    const tree = new TreeViewElement(provider(items));
    const app = TestApp.createWithContent(tree, new Size(width, 4));
    await tree.refresh();
    app.render();
    return { tree, app };
}

function rowText(app: TestApp, y: number): string {
    app.render();
    return app.backend.screenToString().split("\n")[y] ?? "";
}

describe("TreeViewElement row description", () => {
    it("the end of a long description stays reachable by horizontal scroll on a row with a badge", async () => {
        const { tree, app } = await mount(
            [
                {
                    id: "a",
                    item: {
                        label: "short",
                        collapsible: false,
                        description: "a-very-long-description-END",
                        badge: "M",
                    },
                },
            ],
            20,
        );

        tree.scrollTo(1000, 0);

        // A label of the same length scrolls to «…END  M»: the badge never covers row text.
        expect(rowText(app, 0)).toMatch(/END\s+M$/);
    });

    it("type-ahead matches the label, not the description", async () => {
        const { tree, app } = await mount(
            [
                { id: "a", item: { label: "alpha", collapsible: false } },
                { id: "b", item: { label: "beta", collapsible: false, description: "quux" } },
            ],
            30,
        );
        tree.focus();

        app.sendKey("q");

        expect(tree.getSelectedNode()?.id).toBe("a");
    });
});

describe("TreeViewElement inline actions", () => {
    const ACTIONS = [
        { label: "Edit", icon: "✎" },
        { label: "Open", icon: "↗" },
    ];

    it("a double click on a glyph of a leaf fires the action and never opens the row", async () => {
        const { tree, app } = await mount(
            [{ id: "a", item: { label: "leaf", collapsible: false, actions: ACTIONS } }],
            20,
        );
        tree.focus();
        const events: string[] = [];
        tree.onInlineAction = (el, index) => events.push(`action ${el.id} ${String(index)}`);
        tree.onActivate = (el) => events.push(`activate ${el.id}`);
        const x = rowText(app, 0).indexOf("↗");

        for (let i = 0; i < 2; i++) {
            app.backend.simulateMouse(mouse(x, 0, "press"));
            app.backend.simulateMouse(mouse(x, 0, "release"));
        }

        expect(events).toStrictEqual(["action a 1", "action a 1"]);
    });

    it("glyphs stay at the viewport's right edge when the tree is scrolled horizontally", async () => {
        const { tree, app } = await mount(
            [
                { id: "a", item: { label: "short", collapsible: false, actions: ACTIONS, badge: "M" } },
                { id: "b", item: { label: "a-label-much-wider-than-the-viewport", collapsible: false } },
            ],
            20,
        );
        tree.focus();

        tree.scrollTo(10, 0);

        expect(rowText(app, 0)).toBe("               ✎ ↗ M");
    });

    it("hover-only actions disappear when the mouse moves below the last row", async () => {
        const { app } = await mount(
            [
                { id: "a", item: { label: "alpha", collapsible: false } },
                { id: "b", item: { label: "beta", collapsible: false, actions: ACTIONS } },
            ],
            20,
        );

        app.backend.simulateMouse(mouse(3, 1, "move"));
        expect(rowText(app, 1)).toContain("✎ ↗");
        app.backend.simulateMouse(mouse(3, 3, "move"));

        expect(rowText(app, 1)).not.toContain("✎");
    });
});
