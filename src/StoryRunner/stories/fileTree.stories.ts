import * as path from "node:path";

import { TreeViewElement } from "@tuidom/elements/tree/treeViewElement";

import { diskFileService } from "../../TestUtils/diskFileService.ts";
import { NULL_TREE_FILE_WATCHER } from "../../vs/platform/files/common/iTreeFileWatcher.ts";
import {
    FileTreeDataProvider,
    type FileTreeNode,
} from "../../vs/workbench/contrib/files/browser/fileTreeDataProvider.ts";
import type { StoryContext, StoryMeta } from "../StoryTypes.ts";

export const meta: StoryMeta = {
    title: "FileTree (diode provider)",
};

export function fileTree(ctx: StoryContext): void {
    const rootPath = ctx.args[0] ?? path.resolve(".");

    // Живого слежения у истории нет: каталоги читаются при раскрытии.
    const provider = new FileTreeDataProvider(rootPath, () => [], diskFileService(), NULL_TREE_FILE_WATCHER);
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
