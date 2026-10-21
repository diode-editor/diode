import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";

describe("ExtensionHost — EditorConfig.generate (workspace.fs, WP7)", () => {
    it("executeCommand creates .editorconfig in the workspace folder via workspace.fs", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.editorconfig", "generateEditorConfig.cjs")],
        });
        try {
            const target = path.join(harness.tmpDir, ".editorconfig");
            expect(fs.existsSync(target)).toBe(false);

            const result = await harness.commandRegistry.execute("EditorConfig.generate");
            expect(result).toBe("generated");

            expect(fs.existsSync(target)).toBe(true);
            const content = fs.readFileSync(target, "utf8");
            expect(content).toContain("root = true");
            expect(content).toContain("indent_style = space");
        } finally {
            await harness.dispose();
        }
    });

    it("a repeated call is idempotent: stat finds the file, no overwrite", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.editorconfig", "generateEditorConfig.cjs")],
        });
        try {
            const target = path.join(harness.tmpDir, ".editorconfig");
            expect(await harness.commandRegistry.execute("EditorConfig.generate")).toBe("generated");
            // Mark the file to catch an overwrite.
            fs.appendFileSync(target, "# sentinel\n");

            expect(await harness.commandRegistry.execute("EditorConfig.generate")).toBe("exists");
            expect(fs.readFileSync(target, "utf8")).toContain("# sentinel");
        } finally {
            await harness.dispose();
        }
    });
});
