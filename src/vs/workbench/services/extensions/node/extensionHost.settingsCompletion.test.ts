import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    documentVersion,
    type IExtensionHarness,
    provideCompletions,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";

import type { IExtensionRegistration } from "./iExtensionEntry.ts";

// `.ts`-main грузится как есть: subprocess тестов — tsx.
const DIODE_SETTINGS_MAIN = fileURLToPath(
    new URL("../../../../../../extensions/diode-settings/main.ts", import.meta.url),
);

function settingsExtension(): IExtensionRegistration {
    return {
        id: "diode.settings",
        manifest: { name: "settings", publisher: "diode", version: "0.1.0" },
        mainPath: DIODE_SETTINGS_MAIN,
        activationEvents: ["onLanguage:json"],
    };
}

/** Текста в запросе нет — субпроцесс берёт его из зеркала открытого документа. */
async function openDocument(
    harness: IExtensionHarness,
    name: string,
    content: string,
): Promise<{ uri: string; versionId: number }> {
    fs.mkdirSync(path.dirname(path.join(harness.tmpDir, name)), { recursive: true });
    const filePath = harness.writeFile(name, content);
    harness.group.openFile(filePath);
    await settle();
    const uri = Uri.file(filePath).toString();
    return { uri, versionId: documentVersion(harness, uri) };
}

/** `{\n    |\n}` — каретка в теле объекта, то есть в позиции ключа. */
const SETTINGS_TEXT = "{\n    \n}";
const SETTINGS_POSITION = { languageId: "json", line: 1, character: 4 };

describe("diode-settings — автодополнение ключей в settings.json", () => {
    it("активируется onLanguage:json и предлагает известные ключи настроек", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [], // проверяем ленивость
            extensions: [settingsExtension()],
        });
        try {
            expect(harness.host.hasExtension("diode.settings")).toBe(false);

            await harness.host.activateByEvent("onLanguage:json");
            await settle();
            expect(harness.host.hasExtension("diode.settings")).toBe(true);

            const settings = await openDocument(harness, ".diode/settings.json", SETTINGS_TEXT);
            const { items } = await provideCompletions(harness, { ...settings, ...SETTINGS_POSITION });
            const labels = items.map((i) => i.label);
            // Ключи из app-дефолтов и из contributes.configuration builtin'ов.
            expect(labels).toContain("editor.tabSize");
            expect(labels).toContain("workbench.colorTheme");
            expect(labels).toContain("git.enabled");

            const gitEnabled = items.find((i) => i.label === "git.enabled");
            expect(gitEnabled?.detail).toContain("boolean");
            expect(gitEnabled?.documentation).toBe("Master switch for the built-in Git integration.");
        } finally {
            await harness.dispose();
        }
    });

    it("в файле .code-workspace предлагает ключи внутри блока settings", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            extensions: [settingsExtension()],
        });
        try {
            await harness.host.activateByEvent("onLanguage:json");
            await settle();
            const file = await openDocument(harness, "web.code-workspace", '{\n  "settings": {\n    \n  }\n}');
            const { items } = await provideCompletions(harness, {
                ...file,
                languageId: "jsonc",
                line: 2,
                character: 4,
            });
            expect(items.map((i) => i.label)).toContain("editor.tabSize");

            const root = await provideCompletions(harness, { ...file, languageId: "jsonc", line: 1, character: 2 });
            expect(root.items).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });

    it("для не-settings JSON селектор не срабатывает → []", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            extensions: [settingsExtension()],
        });
        try {
            await harness.host.activateByEvent("onLanguage:json");
            await settle();
            const other = await openDocument(harness, "other.json", SETTINGS_TEXT);
            const result = await provideCompletions(harness, { ...other, ...SETTINGS_POSITION });
            expect(result).toEqual({ items: [], isIncomplete: false });
        } finally {
            await harness.dispose();
        }
    });
});

// `readRange` берёт range только через `instanceof Range`: сквозняк проверяет, что
// расширение и хост видят один класс. Потеряйся range — кавычки удвоились бы.
describe("diode-settings — кавычки и значения (e2e через subprocess)", () => {
    /** Каретка — маркер `|`. */
    async function complete(marked: string) {
        const offset = marked.indexOf("|");
        if (offset === -1) throw new Error("В кейсе нет маркера каретки `|`");
        const text = marked.replace("|", "");
        const before = text.slice(0, offset);
        const line = before.split("\n").length - 1;
        const character = offset - (before.lastIndexOf("\n") + 1);

        const harness = await createExtensionTestHarness({
            activateEvents: [],
            extensions: [settingsExtension()],
        });
        try {
            await harness.host.activateByEvent("onLanguage:json");
            await settle();
            const settings = await openDocument(harness, ".diode/settings.json", text);
            const result = await provideCompletions(harness, { ...settings, languageId: "json", line, character });
            return result.items;
        } finally {
            await harness.dispose();
        }
    }

    it("ключ вставляется в кавычках, а range накрывает уже набранную кавычку", async () => {
        const items = await complete('{\n    "edi|\n}');
        const item = items.find((i) => i.label === "editor.tabSize");

        expect(item).toBeDefined();
        expect(item?.insertText).toBe('"editor.tabSize"'); // виден без кавычек, вставляется в них
        // [4,8) на строке 1 — это `"edi`, вместе с кавычкой.
        expect(item?.range).toEqual({
            start: { line: 1, character: 4 },
            end: { line: 1, character: 8 },
        });
    });

    it("range накрывает обе кавычки, когда ключ уже закрыт", async () => {
        const items = await complete('{\n    "edi|"\n}');
        const item = items.find((i) => i.label === "editor.tabSize");

        expect(item?.range).toEqual({
            start: { line: 1, character: 4 },
            end: { line: 1, character: 9 }, // `"edi"`
        });
    });

    it("boolean-настройка предлагает true/false", async () => {
        const items = await complete('{\n    "editor.insertSpaces": |\n}');
        expect(items.map((i) => i.label)).toEqual(["true", "false"]);
    });

    it("enum-настройка предлагает варианты по схеме", async () => {
        const items = await complete('{\n    "terminal.tier": |\n}');
        expect(items.map((i) => i.label)).toEqual(['"auto"', '"legacy"', '"csi-u"', '"kitty"']);
    });

    it("workbench.colorTheme предлагает имена встроенных тем", async () => {
        const items = await complete('{\n    "workbench.colorTheme": |\n}');
        expect(items.map((i) => i.label)).toContain('"Dark Modern"');
    });

    it("строковое значение заменяется вместе с кавычками", async () => {
        const items = await complete('{\n    "terminal.tier": "a|"\n}');
        const auto = items.find((i) => i.label === '"auto"');

        expect(auto?.insertText).toBe('"auto"');
        // [21,24) — это `"a"` целиком; вставка не оставит лишней кавычки.
        expect(auto?.range).toEqual({
            start: { line: 1, character: 21 },
            end: { line: 1, character: 24 },
        });
    });

    it("настройка без enum предлагает свой дефолт", async () => {
        const items = await complete('{\n    "editor.tabSize": |\n}');
        expect(items.map((i) => i.label)).toEqual(["4"]);
        expect(items[0].detail).toBe("default");
    });

    it("вложенный объект — не наша зона, подсказок нет", async () => {
        const items = await complete('{\n    "terminal.capabilities": { "osc|" }\n}');
        expect(items).toEqual([]);
    });

    it("пустой документ: позиции ключа ещё нет → []", async () => {
        expect(await complete("|")).toEqual([]);
    });
});
