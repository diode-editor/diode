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

// The `.ts` main is loaded as is: the test subprocess runs under tsx.
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

/** The request carries no text: the subprocess takes it from the mirror of the open document. */
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

/** `{\n    |\n}`: the cursor in the object body, i.e. at a key position. */
const SETTINGS_TEXT = "{\n    \n}";
const SETTINGS_POSITION = { languageId: "json", line: 1, character: 4 };

describe("diode-settings — key completion in settings.json", () => {
    it("activates on onLanguage:json and suggests known setting keys", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [], // checks laziness
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
            // Keys from the app defaults and from the builtins' contributes.configuration.
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

    it("in a .code-workspace file suggests keys inside the settings block", async () => {
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

    it("for non-settings JSON the selector does not match → []", async () => {
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

// `readRange` accepts a range only via `instanceof Range`: the end-to-end run checks that the
// extension and the host see the same class. If the range were lost, the quotes would double.
describe("diode-settings — quotes and values (e2e via subprocess)", () => {
    /** The cursor is the `|` marker. */
    async function complete(marked: string) {
        const offset = marked.indexOf("|");
        if (offset === -1) throw new Error("The case has no cursor marker `|`");
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

    it("the key is inserted quoted, and the range covers the already typed quote", async () => {
        const items = await complete('{\n    "edi|\n}');
        const item = items.find((i) => i.label === "editor.tabSize");

        expect(item).toBeDefined();
        expect(item?.insertText).toBe('"editor.tabSize"'); // shown without quotes, inserted inside them
        // [4,8) on line 1 is `"edi`, including the quote.
        expect(item?.range).toEqual({
            start: { line: 1, character: 4 },
            end: { line: 1, character: 8 },
        });
    });

    it("the range covers both quotes when the key is already closed", async () => {
        const items = await complete('{\n    "edi|"\n}');
        const item = items.find((i) => i.label === "editor.tabSize");

        expect(item?.range).toEqual({
            start: { line: 1, character: 4 },
            end: { line: 1, character: 9 }, // `"edi"`
        });
    });

    it("a boolean setting suggests true/false", async () => {
        const items = await complete('{\n    "editor.insertSpaces": |\n}');
        expect(items.map((i) => i.label)).toEqual(["true", "false"]);
    });

    it("an enum setting suggests the schema's values", async () => {
        const items = await complete('{\n    "terminal.tier": |\n}');
        expect(items.map((i) => i.label)).toEqual(['"auto"', '"legacy"', '"csi-u"', '"kitty"']);
    });

    it("workbench.colorTheme suggests built-in theme names", async () => {
        const items = await complete('{\n    "workbench.colorTheme": |\n}');
        expect(items.map((i) => i.label)).toContain('"Dark Modern"');
    });

    it("a string value is replaced together with its quotes", async () => {
        const items = await complete('{\n    "terminal.tier": "a|"\n}');
        const auto = items.find((i) => i.label === '"auto"');

        expect(auto?.insertText).toBe('"auto"');
        // [21,24) is the whole `"a"`; the insertion leaves no extra quote.
        expect(auto?.range).toEqual({
            start: { line: 1, character: 21 },
            end: { line: 1, character: 24 },
        });
    });

    it("a setting without enum suggests its default", async () => {
        const items = await complete('{\n    "editor.tabSize": |\n}');
        expect(items.map((i) => i.label)).toEqual(["4"]);
        expect(items[0].detail).toBe("default");
    });

    it("a nested object is out of scope: no suggestions", async () => {
        const items = await complete('{\n    "terminal.capabilities": { "osc|" }\n}');
        expect(items).toEqual([]);
    });

    it("empty document: no key position yet → []", async () => {
        expect(await complete("|")).toEqual([]);
    });
});
