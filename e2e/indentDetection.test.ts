import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

/**
 * Автоопределение отступа на настоящем бинаре. Юнит-тесты детектора и проводки
 * конфига по отдельности были зелёными и при сломанной фиче: детекция честно
 * считала 2, а `applyConfigurationToEditor` тут же ставила дефолт реестра (4) и
 * гасила детект. Проверять это имеет смысл только там, где собраны обе
 * половины, — в запущенном приложении.
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

describe("indent detection — на запущенном приложении", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("package.json открывается с отступом в 2 пробела", async () => {
        const { session } = await useHeadlessApp({
            files: { "package.json": PACKAGE_JSON },
            open: ["package.json"],
        });

        const editor = await session.waitForNode("EditorElement");

        expect(editor.state?.tabSize).toBe(2);
        expect(editor.state?.insertSpaces).toBe(true);
    }, 120_000);

    it("файл с табами открывается на табах, хотя дефолт editor.insertSpaces — true", async () => {
        const { session } = await useHeadlessApp({ files: { "t.ts": TAB_INDENTED }, open: ["t.ts"] });

        const editor = await session.waitForNode("EditorElement");

        expect(editor.state?.insertSpaces).toBe(false);
    }, 120_000);

    it("editor.detectIndentation:false возвращает власть настройкам", async () => {
        const { session } = await useHeadlessApp({
            files: { "package.json": PACKAGE_JSON },
            open: ["package.json"],
            settings: { "editor.detectIndentation": false, "editor.tabSize": 8 },
        });

        const editor = await session.waitForNode("EditorElement");

        expect(editor.state?.tabSize).toBe(8);
    }, 120_000);
});
