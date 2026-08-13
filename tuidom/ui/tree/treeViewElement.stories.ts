import { packRgb } from "../../common/colorUtils.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";
import type { StoryContext, StoryMeta } from "../../testing/storyTypes.ts";
import { HFlexElement, hflexFill, hflexFixed } from "../layout/hFlexElement.ts";

import type { ITreeDataProvider, ITreeItem } from "./iTreeDataProvider.ts";
import { TreeViewElement } from "./treeViewElement.ts";

// История про живой файловый провайдер (watchDirectory и т.п.) живёт на
// стороне приложения: src/StoryRunner/stories/fileTree.stories.ts.

export const meta: StoryMeta = {
    title: "TreeViewElement",
};

// ─── Focus-switch demo ───

interface DemoNode {
    id: string;
    label: string;
    children?: DemoNode[];
}

const DEMO_TREE: DemoNode[] = [
    {
        id: "src",
        label: "src",
        children: [
            { id: "src/main.ts", label: "main.ts" },
            { id: "src/app.ts", label: "app.ts" },
            {
                id: "src/utils",
                label: "utils",
                children: [
                    { id: "src/utils/helper.ts", label: "helper.ts" },
                    { id: "src/utils/format.ts", label: "format.ts" },
                ],
            },
        ],
    },
    {
        id: "docs",
        label: "docs",
        children: [
            { id: "docs/readme.md", label: "readme.md" },
            { id: "docs/guide.md", label: "guide.md" },
        ],
    },
    { id: "package.json", label: "package.json" },
    { id: "tsconfig.json", label: "tsconfig.json" },
];

function createDemoProvider(): ITreeDataProvider<DemoNode> {
    return {
        getTreeItem(element: DemoNode): ITreeItem {
            return {
                label: element.label,
                collapsible: (element.children?.length ?? 0) > 0,
            };
        },
        getChildren(element?: DemoNode): DemoNode[] {
            if (!element) return DEMO_TREE;
            return element.children ?? [];
        },
        getKey(element: DemoNode): string {
            return element.id;
        },
    };
}

class FocusPanel extends TUIElement {
    private label: string;
    private focusedBg = packRgb(0, 120, 215);
    private blurredBg = packRgb(50, 50, 50);
    private focusedFg = packRgb(255, 255, 255);
    private blurredFg = packRgb(180, 180, 180);

    public constructor(label: string) {
        super();
        this.focusable = true;
        this.label = label;
    }

    public render(context: RenderContext): void {
        const w = this.layoutSize.width;
        const h = this.layoutSize.height;
        const bg = this.isFocused ? this.focusedBg : this.blurredBg;
        const fg = this.isFocused ? this.focusedFg : this.blurredFg;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                context.setCell(x, y, { char: " ", fg, bg });
            }
        }

        const text = this.isFocused ? `[${this.label}] (focused)` : `[${this.label}] (press Tab)`;
        const startX = Math.max(0, Math.floor((w - text.length) / 2));
        const midY = Math.floor(h / 2);
        for (let i = 0; i < text.length && startX + i < w; i++) {
            context.setCell(startX + i, midY, { char: text[i], fg, bg });
        }
    }
}

export function focusSwitch(ctx: StoryContext): void {
    ctx.body.title = "TreeView Focus Demo — Tab to switch focus";

    const tree = new TreeViewElement(createDemoProvider());

    const rightPanel = new FocusPanel("Right Panel");

    const layout = new HFlexElement();
    layout.addChild(tree, { width: hflexFixed(30), height: "fill" });
    layout.addChild(rightPanel, { width: hflexFill(), height: "fill" });

    ctx.body.setContent(layout);

    ctx.afterRun(async () => {
        await tree.refresh();
        await tree.toggleExpand(DEMO_TREE[0]);
        tree.focus();
    });
}
