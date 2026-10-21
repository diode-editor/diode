import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

/**
 * Unit tests of the detector and the config wiring were green while the feature was broken: detection
 * computed 2, and `applyConfigurationToEditor` immediately set the registry default (4).
 * This is caught only where both halves are assembled — in the running app.
 */

const PACKAGE_JSON = `{
  "name": "diode",
  "version": "0.3.0",
  "scripts": {
    "start": "tsx src/vs/diode/main.ts",
    "build": "tsup",
    "test": "vitest run"
  },
  "engines": {
    "node": ">=24.0.0"
  }
}
`;

const TAB_INDENTED = "function foo() {\n\tconst x = 1;\n\tif (x) {\n\t\treturn x;\n\t}\n}\n";

describe("indent detection — on the running app", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("package.json opens with 2-space indentation", async () => {
        const { session } = await useHeadlessApp({
            files: { "package.json": PACKAGE_JSON },
            open: ["package.json"],
        });

        const editor = await session.waitForNode("EditorElement");

        expect(editor.state?.tabSize).toBe(2);
        expect(editor.state?.insertSpaces).toBe(true);
    }, 120_000);

    it("a tab-indented file opens with tabs although editor.insertSpaces defaults to true", async () => {
        const { session } = await useHeadlessApp({ files: { "t.ts": TAB_INDENTED }, open: ["t.ts"] });

        const editor = await session.waitForNode("EditorElement");

        expect(editor.state?.insertSpaces).toBe(false);
    }, 120_000);

    it("editor.detectIndentation:false hands control back to the settings", async () => {
        const { session } = await useHeadlessApp({
            files: { "package.json": PACKAGE_JSON },
            open: ["package.json"],
            settings: { "editor.detectIndentation": false, "editor.tabSize": 8 },
        });

        const editor = await session.waitForNode("EditorElement");

        expect(editor.state?.tabSize).toBe(8);
    }, 120_000);
});
