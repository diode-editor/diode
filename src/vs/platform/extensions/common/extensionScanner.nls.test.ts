import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FsAssetAccess } from "../../../base/node/assets/fsAssetAccess.ts";
import { ExtensionThemeContributor } from "../../../workbench/services/extensions/common/extensionThemeContributor.ts";
import { ThemeRegistry } from "../../../workbench/services/themes/common/themeRegistry.ts";

import { scanExtensions } from "./extensionScanner.ts";

const ROOT_PREFIX = "UserExtensions/";

/**
 * Резолв `%ключей%` манифеста — на сквозном пути сканирования. Проверяется
 * именно `scanExtensions`, потому что это единственная точка, через которую
 * манифест попадает к потребителям: и builtin из бандла, и установленные
 * расширения.
 */
describe("scanExtensions — локализация манифеста", () => {
    let tempDir: string;
    let assets: FsAssetAccess;

    beforeEach(async () => {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "diode-ext-nls-"));
        assets = new FsAssetAccess({ [ROOT_PREFIX]: tempDir });
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    async function writeExtension(
        dirName: string,
        manifest: object,
        nlsFiles: Readonly<Record<string, object>> = {},
    ): Promise<void> {
        const dir = path.join(tempDir, dirName);
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(path.join(dir, "package.json"), JSON.stringify(manifest));
        for (const [file, content] of Object.entries(nlsFiles)) {
            await fs.promises.writeFile(path.join(dir, file), JSON.stringify(content));
        }
    }

    const BASE = { name: "java", publisher: "redhat", version: "1.0.0" };

    it("заголовки команд, displayName и label темы приезжают человеческими", async () => {
        await writeExtension(
            "redhat.java-1.0.0",
            {
                ...BASE,
                displayName: "%displayName%",
                contributes: {
                    commands: [{ command: "java.clean", title: "%java.clean%", category: "Java" }],
                    themes: [{ label: "%theme.label%", uiTheme: "vs-dark", path: "./dark.json" }],
                },
            },
            {
                "package.nls.json": {
                    displayName: "Language Support for Java(TM)",
                    "java.clean": "Clean Java Language Server Workspace",
                    "theme.label": "Java Dark",
                },
            },
        );

        const [ext] = await scanExtensions(assets, ROOT_PREFIX, { isBuiltin: false });

        expect(ext.manifest.displayName).toBe("Language Support for Java(TM)");
        expect(ext.manifest.contributes?.commands?.[0].title).toBe("Clean Java Language Server Workspace");
        // Категория — отдельное поле, в заголовок её не вклеивают.
        expect(ext.manifest.contributes?.commands?.[0].category).toBe("Java");
        expect(ext.manifest.contributes?.themes?.[0].label).toBe("Java Dark");
    });

    it("id расширения берётся из технических полей, а не из локализованных", async () => {
        await writeExtension(
            "redhat.java-1.0.0",
            { ...BASE, displayName: "%displayName%" },
            {
                "package.nls.json": { displayName: "Java" },
            },
        );

        const [ext] = await scanExtensions(assets, ROOT_PREFIX, { isBuiltin: false });

        expect(ext.id).toBe("redhat.java");
    });

    it("бандл выбранной локали перебивает базовый", async () => {
        await writeExtension(
            "redhat.java-1.0.0",
            { ...BASE, contributes: { commands: [{ command: "java.clean", title: "%java.clean%" }] } },
            {
                "package.nls.json": { "java.clean": "Clean Workspace" },
                "package.nls.ko.json": { "java.clean": "작업 영역 정리" },
            },
        );

        const [ext] = await scanExtensions(assets, ROOT_PREFIX, { isBuiltin: false, locale: "ko" });

        expect(ext.manifest.contributes?.commands?.[0].title).toBe("작업 영역 정리");
    });

    it("нет nls-файла — расширение всё равно грузится, строка остаётся ключом", async () => {
        await writeExtension("redhat.java-1.0.0", {
            ...BASE,
            displayName: "%displayName%",
            contributes: { commands: [{ command: "java.clean", title: "%java.clean%" }] },
        });

        const result = await scanExtensions(assets, ROOT_PREFIX, { isBuiltin: false });

        expect(result).toHaveLength(1);
        expect(result[0].manifest.displayName).toBe("%displayName%");
        expect(result[0].manifest.contributes?.commands?.[0].title).toBe("%java.clean%");
    });

    it("битый nls-файл — расширение грузится с нерезолвленными строками", async () => {
        const dir = path.join(tempDir, "redhat.java-1.0.0");
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(
            path.join(dir, "package.json"),
            JSON.stringify({ ...BASE, displayName: "%displayName%" }),
        );
        await fs.promises.writeFile(path.join(dir, "package.nls.json"), "{not json");

        const result = await scanExtensions(assets, ROOT_PREFIX, { isBuiltin: false });

        expect(result).toHaveLength(1);
        expect(result[0].manifest.displayName).toBe("%displayName%");
    });

    // Реестр тем — второй потребитель, у которого дыра была видна глазами:
    // темы регистрируются по `label`, а он тоже бывает `%ключом%`, и в пикере
    // вместо имени темы стоял бы ключ. Резолв приезжает со сканирования, своего
    // у контрибьютора нет — проверяем именно эту связку.
    it("label темы доезжает до ThemeRegistry локализованным", async () => {
        const dirName = "redhat.java-1.0.0";
        await writeExtension(
            dirName,
            {
                ...BASE,
                contributes: { themes: [{ label: "%theme.label%", uiTheme: "vs-dark", path: "./dark.json" }] },
            },
            { "package.nls.json": { "theme.label": "Java Dark" } },
        );
        await fs.promises.writeFile(
            path.join(tempDir, dirName, "dark.json"),
            JSON.stringify({ colors: { "editor.background": "#101820" } }),
        );

        const extensions = await scanExtensions(assets, ROOT_PREFIX, { isBuiltin: false });
        const registry = new ThemeRegistry();
        await new ExtensionThemeContributor(assets, extensions, registry).apply();

        expect(registry.list()).toEqual([{ label: "Java Dark", type: "dark" }]);
        expect(registry.has("%theme.label%")).toBe(false);
    });

    it("по умолчанию берётся локаль интерфейса — базовый бандл", async () => {
        await writeExtension(
            "redhat.java-1.0.0",
            { ...BASE, displayName: "%displayName%" },
            {
                "package.nls.json": { displayName: "Java (en)" },
                "package.nls.ko.json": { displayName: "Java (ko)" },
            },
        );

        const [ext] = await scanExtensions(assets, ROOT_PREFIX, { isBuiltin: false });

        expect(ext.manifest.displayName).toBe("Java (en)");
    });
});
