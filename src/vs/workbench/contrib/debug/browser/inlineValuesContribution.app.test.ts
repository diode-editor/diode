// Inline values on the whole workbench with the synthetic debugger, whose program's `main.cpp` is a real file here:
// the stop shows the variables' values after the lines up to it, in their colors; a step and a continue update them;
// `auto` waits for a provider of the language, and a provider's values come after a failed test's message.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { compositeOver } from "@tuidom/core/common/colorUtils";
import { Point } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugViewletHarness, type IDebugViewletHarness } from "../../../../../TestUtils/debugViewletHarness.ts";
import { numAt } from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

/** `main.cpp` of the synthetic program: it stops in `accumulate` on line 27, `continue` on line 31. */
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

describe("Inline values in the editor", () => {
    let root: string;
    let t: IDebugViewletHarness;

    beforeEach(async () => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "diode-inline-values-")));
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

    it("on: the stop shows the values after the lines up to it; a step and a continue update them", async () => {
        await t.h.container.get(IConfigurationServiceDIToken).updateValue("debug.inlineValues", "on");
        await t.startStopped();

        await vi.waitFor(() => {
            expect(rowOf("long sum = 0;")).toBe("long sum = 0;  sum = 0");
        });
        expect(rowOf("for (i : nums) {")).toBe("for (i : nums) {  i = 0, nums = size=1000");
        // Below the stop: nothing yet.
        expect(rowOf("sum += nums[i];")).toBe("sum += nums[i];");

        // In the inline values' colors, over the editor's background.
        const vars = t.vars();
        const code = t.find("long sum = 0;");
        const value = new Point(code.x + "long sum = 0;  ".length, code.y);
        const bg = compositeOver(vars["editor.inlineValuesBackground"], vars["editor.background"]);
        expect(t.h.testApp.backend.getBgAt(value)).toBe(bg);
        expect(t.h.testApp.backend.getFgAt(value)).toBe(compositeOver(vars["editor.inlineValuesForeground"], bg));
        // The gap before it is the editor's.
        expect(t.h.testApp.backend.getBgAt(new Point(value.x - 1, value.y))).toBe(vars["editor.background"]);

        t.h.testApp.sendKey("F10");
        await vi.waitFor(() => {
            // `i` follows, cut by the editor's edge.
            expect(rowOf("sum += nums[i];")).toMatch(/^sum \+= nums\[i\]; {2}sum = 0, nums = size=1000/);
        });

        t.h.testApp.sendKey("F5");
        let sum = 0;
        for (let i = 0; i < 100; i++) sum += numAt(i);
        await vi.waitFor(() => {
            expect(rowOf("long sum = 0;")).toBe(`long sum = 0;  sum = ${String(sum)}`);
        });
        expect(rowOf("return sum;")).toBe(`return sum;  sum = ${String(sum)}`);
    });

    it("auto: none until a provider of the language answers; its values follow a test's message", async () => {
        await t.startStopped();
        await vi.waitFor(() => {
            expect(t.find("long sum = 0;")).toBeDefined();
        });
        // Long enough for the values, had they been shown.
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(rowOf("long sum = 0;")).toBe("long sum = 0;");

        const editor = t.h.container.get(EditorServiceDIToken).getActiveEditor();
        if (editor === null) throw new Error("main.cpp is not open");
        editor.setLineMessageDecorations("testing", [
            { key: "t", line: 25, text: "✗ failed", colorToken: "testing.message.error.badgeForeground" },
        ]);
        t.h.container.get(LanguageFeaturesServiceDIToken).inlineValuesProvider.register(editor.languageId, {
            provideInlineValues: () =>
                Promise.resolve([
                    { type: "variable", range: createRange(25, 9, 25, 12), caseSensitiveLookup: true },
                    { type: "expression", range: createRange(25, 4, 25, 8), expression: "sum" },
                ]),
        });
        await vi.waitFor(() => {
            expect(rowOf("long sum = 0;")).toBe("long sum = 0;  ✗ failed  sum = 0");
        });
    });
});
