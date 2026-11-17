// The legacy boolean `debug.inlineValues` on the whole workbench, as upstream reads it: `true` means `on` — the
// synthetic debugger's stop in `accumulate` of `main.cpp` shows the values from the frame without any provider.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugViewletHarness, type IDebugViewletHarness } from "../../../../../TestUtils/debugViewletHarness.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";

/** `main.cpp` of the synthetic program: it stops in `accumulate` on line 27. */
const SOURCE = Array.from({ length: 40 }, (_, i) => {
    switch (i + 1) {
        case 26:
            return "    long sum = 0;";
        case 27:
            return "    for (i : nums) {";
        default:
            return `// line ${String(i + 1)}`;
    }
}).join("\n");

describe("Inline values with the legacy boolean setting", () => {
    let root: string;
    let t: IDebugViewletHarness;

    beforeEach(async () => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "diode-inline-values-legacy-")));
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

    it("true shows the values as on does, with no provider of the language", async () => {
        await t.h.container.get(IConfigurationServiceDIToken).updateValue("debug.inlineValues", true);
        await t.startStopped();

        await vi.waitFor(() => {
            expect(rowOf("long sum = 0;")).toBe("long sum = 0;  sum = 0");
        });
    });
});
