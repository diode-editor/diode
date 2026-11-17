import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    documentVersion,
    extensionFixture,
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

const SETTINGS_EXTENSION: IExtensionRegistration = {
    id: "diode.settings",
    manifest: { name: "settings", publisher: "diode", version: "0.1.0" },
    mainPath: DIODE_SETTINGS_MAIN,
    activationEvents: ["onLanguage:json"],
};

/** A debugger extension known only by its manifest: the completion reads `contributes.debuggers`, not its code. */
const SYNTHETIC_DEBUGGER: IExtensionRegistration = {
    ...extensionFixture("test.synthetic-debug", "noopExtension.cjs"),
    activationEvents: [],
    manifest: {
        name: "synthetic-debug",
        publisher: "test",
        version: "0.0.1",
        contributes: {
            debuggers: [
                {
                    type: "synthetic",
                    label: "Synthetic Debug",
                    configurationAttributes: {
                        launch: {
                            properties: {
                                program: { type: "string", description: "Absolute path to the program." },
                                stopOnEntry: { type: "boolean", description: "Stop after launch.", default: false },
                            },
                        },
                    },
                    configurationSnippets: [
                        {
                            label: "Synthetic: Launch",
                            description: "A new synthetic configuration.",
                            body: { type: "synthetic", request: "launch", name: "${1:Launch}" },
                        },
                    ],
                },
            ],
        },
    },
};

describe("diode-settings — IntelliSense in launch.json (e2e via subprocess)", () => {
    let harness: IExtensionHarness;

    beforeEach(async () => {
        harness = await createExtensionTestHarness({
            activateEvents: [],
            extensions: [SETTINGS_EXTENSION, SYNTHETIC_DEBUGGER],
        });
        await harness.host.activateByEvent("onLanguage:json");
        await settle();
    });

    afterEach(async () => {
        await harness.dispose();
    });

    /** The cursor is the `|` marker. */
    async function complete(name: string, marked: string, languageId = "json") {
        const offset = marked.indexOf("|");
        const text = marked.replace("|", "");
        const before = text.slice(0, offset);
        const line = before.split("\n").length - 1;
        const character = offset - (before.lastIndexOf("\n") + 1);
        fs.mkdirSync(path.dirname(path.join(harness.tmpDir, name)), { recursive: true });
        const filePath = harness.writeFile(name, text);
        harness.group.openFile(filePath);
        await settle();
        const uri = Uri.file(filePath).toString();
        const result = await provideCompletions(harness, {
            uri,
            versionId: documentVersion(harness, uri),
            languageId,
            line,
            character,
        });
        return result.items;
    }

    it('after `"type": "synthetic",` suggests the debugger\'s attributes with their descriptions', async () => {
        const items = await complete(
            ".diode/launch.json",
            '{\n  "configurations": [\n    {\n      "type": "synthetic",\n      "|\n    }\n  ]\n}',
        );
        const program = items.find((i) => i.label === "program");
        expect(program).toMatchObject({ insertText: '"program"', documentation: "Absolute path to the program." });
        // The range covers the typed quote: the insertion does not double it.
        expect(program?.range).toEqual({ start: { line: 4, character: 6 }, end: { line: 4, character: 7 } });
        expect(items.map((i) => i.label)).toEqual(expect.arrayContaining(["stopOnEntry", "request", "name"]));
        expect(items.map((i) => i.label)).not.toContain("type");
    });

    it("upstream's .vscode/launch.json as jsonc: `type` suggests the registered debuggers", async () => {
        const types = await complete(".vscode/launch.json", '{ "configurations": [ { "type": | } ] }', "jsonc");
        expect(types.map((i) => i.label)).toEqual(['"synthetic"']);
    });

    it("in place of a configuration suggests the debugger's snippets as snippets", async () => {
        const items = await complete(".diode/launch.json", '{\n  "configurations": [\n    |\n  ]\n}');
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ label: "Synthetic: Launch", documentation: "A new synthetic configuration." });
        // No snippet sessions in Diode: the placeholder's text goes in, the lines indented from the caret's line
        // in the editor's unit (two spaces, detected from the file).
        expect(items[0].insertText).toBe(
            '{\n      "type": "synthetic",\n      "request": "launch",\n      "name": "Launch"\n    }',
        );
    });

    it("`launch` of settings.json and of a .code-workspace file", async () => {
        const settings = await complete(
            ".diode/settings.json",
            '{ "launch": { "configurations": [ { "type": "synthetic", | } ] } }',
        );
        expect(settings.map((i) => i.label)).toContain("program");

        const workspace = await complete(
            "web.code-workspace",
            '{ "settings": { "launch": { "configurations": [ { "type": "synthetic", | } ] } } }',
            "jsonc",
        );
        expect(workspace.map((i) => i.label)).toContain("program");
    });

    it("another JSON file named launch.json outside .diode/.vscode gets nothing", async () => {
        const items = await complete("launch.json", '{ "configurations": [ { "type": "synthetic", | } ] }');
        expect(items).toEqual([]);
    });
});
