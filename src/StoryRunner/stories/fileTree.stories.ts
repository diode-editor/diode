import * as path from "node:path";

import type { StoryContext, StoryMeta } from "../StoryTypes.ts";
import { TreeViewElement } from "../../../tuidom/ui/tree/treeViewElement.ts";
import {
    FileTreeDataProvider,
    type FileTreeNode,
} from "../../vs/workbench/contrib/files/browser/fileTreeDataProvider.ts";

export const meta: StoryMeta = {
    title: "FileTree (vexx provider)",
};

export function fileTree(ctx: StoryContext): void {
    const rootPath = ctx.args[0] ?? path.resolve(".");

    const provider = new FileTreeDataProvider(rootPath);
    const tree = new TreeViewElement<FileTreeNode>(provider);
    tree.onExpandedChanged = (node, expanded) => {
        if (expanded) {
            provider.watchDirectory(node.path);
        } else {
            provider.unwatchDirectory(node.path);
        }
    };
    tree.onActivate = (node) => {
        if (!node.isDirectory) {
            console.log("Activate file:", node.path);
        }
    };

    ctx.body.setContent(tree);

    ctx.afterRun(() => {
        tree.focus();
        void tree.refresh();
    });
}
