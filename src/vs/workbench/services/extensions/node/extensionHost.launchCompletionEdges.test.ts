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
                                trace: {
                                    enum: ["off", "verbose"],
                                    enumDescriptions: ["No trace.", "Everything."],
                                    description: "Trace level.",
                                },
                            },
                        },
                        attach: { properties: { processId: { type: "string", description: "Process to attach to." } } },
                    },
                    configurationSnippets: [
                        {
                            label: "Synthetic: Launch",
                            description: "A new synthetic configuration.",
                            body: { type: "synthetic", request: "launch", name: "${1:Launch}" },
                        },
                    ],
                },
                {
                    type: "other",
                    label: "Other Debug",
                    configurationAttributes: {
                        launch: { properties: { otherOnly: { type: "string", description: "Nur für other ✓ — ü." } } },
                    },
                },
            ],
        },
    },
};

describe("diode-settings — launch.json IntelliSense edge cases (e2e via subprocess)", () => {
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

    const labels = (items: readonly { label: unknown }[]) => items.map((i) => i.label);

    it("`request` suggests the debugger's requests; `attach` narrows the attributes to its own", async () => {
        const requests = await complete(
            "a/.diode/launch.json",
            '{ "configurations": [ { "type": "synthetic", "request": "|" } ] }',
        );
        expect(labels(requests)).toEqual(['"launch"', '"attach"']);
        // The range covers both quotes: accepting does not leave `""launch""`.
        expect(requests[0].range).toEqual({ start: { line: 0, character: 56 }, end: { line: 0, character: 58 } });

        const attach = labels(
            await complete(
                "b/.diode/launch.json",
                '{ "configurations": [ { "type": "synthetic", "request": "attach", | } ] }',
            ),
        );
        expect(attach).toContain("processId");
        expect(attach).not.toContain("program");
    });

    it("enum values come with their enumDescriptions, booleans replace the typed prefix", async () => {
        const trace = await complete(
            "c/.diode/launch.json",
            '{ "configurations": [ { "type": "synthetic", "trace": | } ] }',
        );
        expect(trace.map((i) => [i.label, i.documentation])).toEqual([
            ['"off"', "No trace."],
            ['"verbose"', "Everything."],
        ]);

        const bool = await complete(
            "d/.diode/launch.json",
            '{ "configurations": [ { "type": "synthetic", "stopOnEntry": f| } ] }',
        );
        expect(labels(bool)).toEqual(["true", "false"]);
        expect(bool[1].range).toEqual({ start: { line: 0, character: 60 }, end: { line: 0, character: 61 } });
    });

    it("keys already set are skipped; nothing is suggested inside a string value", async () => {
        const present = labels(
            await complete(
                "e/.diode/launch.json",
                '{ "configurations": [ { "type": "synthetic", "program": "a", | } ] }',
            ),
        );
        expect(present).toContain("stopOnEntry");
        expect(present).not.toContain("program");
        expect(present).not.toContain("type");

        const inString = await complete(
            "f/.diode/launch.json",
            '{ "configurations": [ { "type": "synthetic", "program": "|" } ] }',
        );
        expect(inString).toEqual([]);
    });

    it("each configuration gets the attributes of its own type, with unicode descriptions intact", async () => {
        const items = await complete(
            "g/.diode/launch.json",
            '{ "configurations": [ { "type": "synthetic" }, { "type": "other", | } ] }',
        );
        expect(labels(items)).toContain("otherOnly");
        expect(labels(items)).not.toContain("program");
        expect(items.find((i) => i.label === "otherOnly")?.documentation).toBe("Nur für other ✓ — ü.");
    });

    it("comments and trailing commas (JSONC) do not break the completion", async () => {
        const items = await complete(
            "h/.diode/launch.json",
            '{\n  // c\n  "configurations": [\n    /* x */ { "type": "synthetic", "name": "a", },\n    { "type": "synthetic", | },\n  ],\n}',
            "jsonc",
        );
        expect(labels(items)).toContain("program");
    });

    it("a snippet before an existing configuration ends with a comma, the one after it does not", async () => {
        const before = await complete(
            "i/.diode/launch.json",
            '{\n  "configurations": [\n    |\n    { "type": "synthetic" }\n  ]\n}',
        );
        expect(before[0].insertText).toBe(
            '{\n      "type": "synthetic",\n      "request": "launch",\n      "name": "Launch"\n    },',
        );
        const after = await complete(
            "j/.diode/launch.json",
            '{\n  "configurations": [\n    { "type": "synthetic" },\n    |\n  ]\n}',
        );
        expect(after[0].insertText).toBe(
            '{\n      "type": "synthetic",\n      "request": "launch",\n      "name": "Launch"\n    }',
        );
    });

    it("top-level keys of launch.json and of `launch` in settings.json", async () => {
        expect(labels(await complete("k/.diode/launch.json", "{|}"))).toEqual([
            "version",
            "configurations",
            "compounds",
        ]);
        expect(labels(await complete("l/.diode/settings.json", '{ "launch": { | } }'))).toEqual([
            "version",
            "configurations",
            "compounds",
        ]);
    });

    it("a `configurations` array under another settings key gets no launch attributes", async () => {
        const items = await complete(
            "m/.diode/settings.json",
            '{ "other": { "configurations": [ { "type": "synthetic", | } ] } }',
        );
        expect(items).toEqual([]);
    });
});
