import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

export const filesConfiguration: IConfigurationNode = {
    id: "files",
    title: "Files",
    properties: {
        "files.enableTrash": {
            type: "boolean",
            default: true,
            description: "Move files to the OS trash when available; when disabled, delete permanently.",
        },
        // Глобы, в которые файловый watcher не заходит. Дефолт — набор VS Code
        // (служебные каталоги git/hg, которые меняются пачками и никого не
        // интересуют) плюс `node_modules`: у нас под watcher'ом chokidar с
        // inotify-watch'ем на каталог, а не нативный рекурсивный watcher, и
        // большой `node_modules` в одиночку съедает лимит ОС.
        "files.watcherExclude": {
            type: "object",
            default: {
                ".git/objects/**": true,
                ".git/subtree-cache/**": true,
                ".hg/store/**": true,
                "*/.git/objects/**": true,
                "*/.git/subtree-cache/**": true,
                "*/.hg/store/**": true,
                "**/node_modules/**": true,
            },
            description:
                "Glob patterns to exclude from file watching. Patterns are matched relative to the watched folder.",
        },
    },
};
