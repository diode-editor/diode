import { describe, expect, it } from "vitest";

import { NULL_TREE_FILE_WATCHER } from "./iTreeFileWatcher.ts";

describe("NULL_TREE_FILE_WATCHER", () => {
    it("подписка валидна и никогда не стреляет", () => {
        let fired = 0;
        const subscription = NULL_TREE_FILE_WATCHER.watchTree("/repo", { recursive: true, excludes: [] }, () => fired++);

        expect(() => subscription.dispose()).not.toThrow();
        expect(fired).toBe(0);
    });
});
