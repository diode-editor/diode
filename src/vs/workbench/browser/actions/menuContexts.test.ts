import { describe, expect, it } from "vitest";

import { editorTabIsFile, editorTabPathArg, editorTabTargetArg, type EditorTitleMenuContext } from "./menuContexts.ts";

/** A bug here is invisible in the UI — the command just acts on the wrong tab. */
const context: EditorTitleMenuContext = {
    groupId: 3,
    index: 2,
    path: "/workspace/alpha.ts",
    resourceScheme: "file",
    tabCount: 4,
    hasTabsToTheRight: true,
    hasSavedTabs: true,
    isPreview: false,
};

describe("tab context menu item arguments", () => {
    it("the tab address is a pair of numbers in (group, index) order", () => {
        expect(editorTabTargetArg(context)).toEqual([3, 2]);
    });

    it("both parts of the address are numbers", () => {
        // The command treats empty or non-numeric arguments as an invocation from the command palette.
        expect(editorTabTargetArg(context).map((value) => typeof value)).toEqual(["number", "number"]);
    });

    it("file items receive the tab path", () => {
        expect(editorTabPathArg(context)).toEqual(["/workspace/alpha.ts"]);
    });

    it("file items are hidden for a tab without a file on disk", () => {
        expect(editorTabIsFile(context)).toBe(true);
        expect(editorTabIsFile({ ...context, path: null })).toBe(false);
    });
});
