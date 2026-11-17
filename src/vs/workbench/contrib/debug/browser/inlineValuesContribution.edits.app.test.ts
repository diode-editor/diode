// Inline values while the text changes under a stop: the synthetic debugger stops in `accumulate` of `main.cpp`
// (line 27) with `debug.inlineValues: on`, then a line is inserted above — every value must stay after a line that
// names its variable.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugViewletHarness, type IDebugViewletHarness } from "../../../../../TestUtils/debugViewletHarness.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

/** `main.cpp` of the synthetic program: it stops in `accumulate` on line 27. */
const SOURCE = Array.from({ length: 40 }, (_, i) => {
    switch (i + 1) {
        case 26:
            return "    long sum = 0;";
        case 27:
            return "    for (i : nums) {";
        case 28:
            return "        sum += nums[i];";
        case 31:
            return "    return sum;";
        default:
            return `// line ${String(i + 1)}`;
    }
}).join("\n");

describe("Inline values when the text changes under a stop", () => {
    let root: string;
    let t: IDebugViewletHarness;

    beforeEach(async () => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "diode-inline-values-edits-")));
        fs.mkdirSync(path.join(root, "src"));
        fs.writeFileSync(path.join(root, "src", "main.cpp"), SOURCE);
        t = await createDebugViewletHarness(root, root);
    });

    afterEach(async () => {
        await t.dispose();
        fs.rmSync(root, { recursive: true, force: true });
    });

    /** The text of the screen row of `code`, from its start. */
    function rowOf(code: string): string {
        const at = t.find(code);
        return t.lines()[at.y].slice(at.x).trimEnd();
    }

    it("a line inserted above the stop does not move the values onto other lines", async () => {
        await t.h.container.get(IConfigurationServiceDIToken).updateValue("debug.inlineValues", "on");
        await t.startStopped();
        await vi.waitFor(() => {
            expect(rowOf("long sum = 0;")).toBe("long sum = 0;  sum = 0");
        });
        expect(rowOf("sum += nums[i];")).toBe("sum += nums[i];");

        const editor = t.h.container.get(EditorServiceDIToken).getActiveEditor();
        if (editor === null) throw new Error("main.cpp is not open");
        // A new line between `// line 24` and `// line 25`.
        editor.viewState.document.applyEdits([createTextEdit(createRange(24, 0, 24, 0), "// inserted\n")]);

        // Past the debounce of the text change: the values have settled.
        await new Promise((resolve) => setTimeout(resolve, 500));
        // `sum += nums[i];` names `sum` and `nums`, never `i` alone; `long sum = 0;` names only `sum`.
        expect(rowOf("// inserted")).toBe("// inserted");
        expect(rowOf("long sum = 0;")).toMatch(/^long sum = 0;( {2}sum = 0)?$/);
        expect(rowOf("for (i : nums) {")).toMatch(/^for \(i : nums\) \{( {2}i = 0, nums = size=1000)?$/);
        expect(rowOf("sum += nums[i];")).not.toMatch(/ {2}i = 0, nums/);
    });
});
