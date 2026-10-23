import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";

import { sameIndentConfiguration } from "./editorComponent.ts";

describe("EditorComponent — indentation configuration reapplied", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-indent-once-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    it("the same configuration again does not re-detect; a changed one does", () => {
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(ws.writeFile("a.ts", "x")));
        const config = { tabSize: 4, insertSpaces: true, detectIndentation: true };
        ctrl.applyIndentConfiguration(config);
        expect(ctrl.viewState.tabSize).toBe(4);

        // The file now says "2 spaces"; only a new configuration is allowed to notice.
        ctrl.viewState.document.applyEdits([createTextEdit(createRange(0, 1, 0, 1), "\n  y\n  z")]);
        ctrl.applyIndentConfiguration({ ...config });
        expect(ctrl.viewState.tabSize).toBe(4);

        ctrl.applyIndentConfiguration({ ...config, tabSize: 8 });
        expect(ctrl.viewState.tabSize).toBe(2);
    });

    it("sameIndentConfiguration compares all three keys, a missing key included", () => {
        expect(sameIndentConfiguration({}, {})).toBe(true);
        expect(sameIndentConfiguration({ tabSize: 2 }, { tabSize: 2 })).toBe(true);
        expect(sameIndentConfiguration({ tabSize: 2 }, {})).toBe(false);
        expect(sameIndentConfiguration({ insertSpaces: true }, { insertSpaces: false })).toBe(false);
        expect(sameIndentConfiguration({ detectIndentation: true }, { detectIndentation: false })).toBe(false);
    });
});
