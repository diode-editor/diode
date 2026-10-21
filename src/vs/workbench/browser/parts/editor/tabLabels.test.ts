import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { describe, expect, it } from "vitest";

import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";

import type { IEditorPane } from "./iEditorPane.ts";
import { computeTabLabels, DELETED_TAB_SUFFIX } from "./tabLabels.ts";

function pane(uriPath: string): IEditorPane {
    return {
        uri: Uri.file(uriPath),
        label: uriPath.split("/").pop() ?? uriPath,
        view: {} as TUIElement,
        isModified: false,
        readOnly: false,
        getSelectedTexts: () => [],
        onDidChangeState: (): IDisposable => ({ dispose: () => {} }),
        focusEditor() {},
        dispose() {},
    };
}

function labels(...paths: string[]): string[] {
    const panes = paths.map(pane);
    return computeTabLabels(panes, (editor) => editor.label);
}

describe("computeTabLabels — disambiguating same-name files by the minimal path suffix", () => {
    it("without same-name files labels are plain file names", () => {
        expect(labels("/p/a.ts", "/p/b.ts")).toEqual(["a.ts", "b.ts"]);
    });

    it("same-name files get the minimal distinguishing parent segment", () => {
        expect(labels("/p/x/a.ts", "/p/y/a.ts", "/p/b.ts")).toEqual(["a.ts — x", "a.ts — y", "b.ts"]);
    });

    it("matching last segment — the suffix grows to the distinguishing tail", () => {
        // dirs: [x, s] and [s]: k=1 collides (s/s); the long path becomes unique
        // at k=2 ("x/s"), the short one at k=2 too (its tail is still "s", but the
        // other tail is now "x/s"). Uniqueness exactly at k = maxK is the loop boundary.
        expect(labels("/x/s/a.ts", "/s/a.ts")).toEqual(["a.ts — x/s", "a.ts — s"]);
    });

    it("file at the root: empty path segments are not part of the suffix", () => {
        // Without filter(Boolean), dirname("/") would yield [""] and "/m/n" ["", "m", "n"],
        // giving the suffixes a leading separator.
        expect(labels("/n/a.ts", "/m/n/a.ts")).toEqual(["a.ts — n", "a.ts — m/n"]);
    });
});

describe("computeTabLabels — deleted file", () => {
    it("an orphaned tab gets the (deleted) suffix, a live tab and a pane without the notion do not", () => {
        const deleted = { ...pane("/p/a.ts"), isOrphaned: true };
        const alive = { ...pane("/p/b.ts"), isOrphaned: false };
        const other = pane("/p/c.ts");
        expect(computeTabLabels([deleted, alive, other], (editor) => editor.label)).toEqual([
            `a.ts${DELETED_TAB_SUFFIX}`,
            "b.ts",
            "c.ts",
        ]);
        expect(DELETED_TAB_SUFFIX).toBe(" (deleted)");
    });

    it("the suffix goes after the distinguishing path suffix and does not disambiguate same-name files", () => {
        const deleted = { ...pane("/x/a.ts"), isOrphaned: true };
        expect(computeTabLabels([deleted, pane("/y/a.ts")], (editor) => editor.label)).toEqual([
            `a.ts — x${DELETED_TAB_SUFFIX}`,
            "a.ts — y",
        ]);
    });
});
