import { describe, expect, it } from "vitest";

import { type LaunchRoot, provideLaunchCompletions, snippetText } from "./launchCompletion.ts";

const SYNTHETIC = {
    contributes: {
        debuggers: [
            {
                type: "synthetic",
                label: "Synthetic Debug",
                configurationAttributes: {
                    launch: {
                        required: ["program"],
                        properties: {
                            program: { type: "string", description: "Absolute path to the program." },
                            stopOnEntry: { type: "boolean", description: "Stop after launch.", default: false },
                            trace: {
                                enum: ["off", "verbose"],
                                enumDescriptions: ["No trace.", "Everything."],
                                default: "off",
                                description: "Trace level.",
                            },
                            port: { type: ["number", "string"], default: 9229, markdownDescription: "The **port**." },
                            hiddenOne: { type: "string", doNotSuggest: true },
                            // Upstream skips a malformed property instead of failing the whole schema.
                            malformed: "integer",
                        },
                    },
                    attach: {
                        properties: { processId: { type: "string", description: "Process to attach to." } },
                    },
                },
                configurationSnippets: [
                    {
                        label: "Synthetic: Launch",
                        description: "A new launch configuration.",
                        body: { type: "synthetic", request: "launch", name: "Launch", program: '^"\\${file}"' },
                    },
                    { label: "no body" },
                ],
            },
        ],
    },
};

/** Adds to `synthetic` from another extension; defines `old` (deprecated) and `addon` (no label: not a debugger). */
const OTHER = {
    contributes: {
        debuggers: [
            {
                type: "synthetic",
                configurationAttributes: { launch: { properties: { extra: { type: "string" } } } },
                configurationSnippets: [{ label: "Synthetic: Extra", body: { type: "synthetic" } }],
            },
            { type: "old", label: "Old", deprecated: "Use synthetic." },
            { type: "addon" },
            { type: 42 },
            "garbage",
        ],
    },
};

const MANIFESTS: readonly unknown[] = [SYNTHETIC, OTHER, { contributes: { debuggers: {} } }, null, {}];

function complete(marked: string, roots: readonly LaunchRoot[] = [[]], manifests = MANIFESTS) {
    const offset = marked.indexOf("|");
    if (offset === -1) throw new Error("The case has no `|` cursor marker");
    const text = marked.replace("|", "");
    const items = provideLaunchCompletions(text, offset, roots, manifests);
    return { items, labels: items.map((i) => i.label), text };
}

describe("provideLaunchCompletions — the top level of launch.json", () => {
    it("suggests version, configurations and compounds with upstream's descriptions", () => {
        const { items } = complete("{\n    |\n}");
        expect(items.map((i) => i.label)).toEqual(["version", "configurations", "compounds"]);
        expect(items[0]).toMatchObject({
            kind: "property",
            insertText: '"version"',
            detail: "string",
            documentation: "Version of this file format.",
        });
    });

    it("skips keys already present, but not the one being typed", () => {
        expect(complete('{\n    "version": "0.2.0",\n    "co|"\n}').labels).toEqual(["configurations", "compounds"]);
        expect(complete('{\n    "version|": "0.2.0"\n}').labels).toEqual(["version", "configurations", "compounds"]);
        // In settings.json the keys are those of the launch block, not of the file.
        const settings = '{ "version": 1, "launch": { "compounds": [], | } }';
        expect(complete(settings, [["launch"]]).labels).toEqual(["version", "configurations"]);
    });

    it("the key replaces the typed quote and word", () => {
        const { items, text } = complete('{\n    "conf|\n}');
        const { start, end } = items[0].replaceRange;
        expect(text.slice(start, end)).toBe('"conf');
    });

    it("version suggests its default", () => {
        expect(complete('{ "version": | }').items).toEqual([
            expect.objectContaining({ label: '"0.2.0"', kind: "value", insertText: '"0.2.0"', detail: "default" }),
        ]);
    });

    it("a key without values → nothing", () => {
        expect(complete('{ "configurations": | }').items).toEqual([]);
        expect(complete('{ "unknown": | }').items).toEqual([]);
    });

    it("outside the launch object → nothing", () => {
        expect(complete('{ "launch": {}, "x": | }', [["launch"]]).items).toEqual([]);
        expect(complete('{ "x": { | } }', [["launch"]]).items).toEqual([]);
        expect(complete('{ "compounds": [ { | } ] }').items).toEqual([]);
        expect(complete('{ "configurations": { "a": { | } } }').items).toEqual([]);
        expect(complete('{ "configurations": [ { "presentation": { | } } ] }').items).toEqual([]);
    });
});

describe("provideLaunchCompletions — attributes of a configuration", () => {
    it("by `type`: the debugger's attributes of all requests while `request` is unset, plus the common ones", () => {
        const { labels } = complete('{ "configurations": [ { "type": "synthetic", | } ] }');
        expect(labels).toEqual([
            "program",
            "stopOnEntry",
            "trace",
            "port",
            "extra",
            "processId",
            "request",
            "name",
            "debugServer",
            "preLaunchTask",
            "postDebugTask",
            "presentation",
            "internalConsoleOptions",
            "suppressMultipleSessionWarning",
            "windows",
            "osx",
            "linux",
        ]);
    });

    it("by `request`: only that request's attributes", () => {
        const launch = complete('{ "configurations": [ { "type": "synthetic", "request": "launch", | } ] }').labels;
        expect(launch).toContain("program");
        expect(launch).not.toContain("processId");

        const attach = complete('{ "configurations": [ { "request": "attach", "type": "synthetic", | } ] }').labels;
        expect(attach).toContain("processId");
        expect(attach).not.toContain("program");
    });

    it("an unknown request → all requests of the debugger", () => {
        const { labels } = complete('{ "configurations": [ { "type": "synthetic", "request": "run", | } ] }');
        expect(labels).toEqual(expect.arrayContaining(["program", "processId"]));
    });

    it("no `type` or an unknown one → only the attributes every configuration has", () => {
        const first = complete('{ "configurations": [ { | } ] }').labels;
        expect(first.slice(0, 4)).toEqual(["type", "request", "name", "debugServer"]);
        expect(first).not.toContain("program");
        expect(complete('{ "configurations": [ { "type": "nope", | } ] }').labels).not.toContain("program");
        expect(complete('{ "configurations": [ { "type": 1, | } ] }').labels).not.toContain("program");
    });

    it("the configuration is found by its index and its own file", () => {
        const second = '{ "configurations": [ { "type": "synthetic" }, { "type": "nope", | } ] }';
        expect(complete(second).labels).not.toContain("program");
        const settings = '{ "launch": { "configurations": [ { "type": "synthetic", | } ] } }';
        expect(complete(settings, [["launch"]]).labels).toContain("program");
        const workspace = '{ "settings": { "launch": { "configurations": [ { "type": "synthetic", | } ] } } }';
        expect(complete(workspace, [["launch"], ["settings", "launch"]]).labels).toContain("program");
    });

    it("an attribute carries its type and description", () => {
        const { items } = complete('{ "configurations": [ { "type": "synthetic", "pro|" } ] }');
        expect(items.find((i) => i.label === "program")).toMatchObject({
            kind: "property",
            insertText: '"program"',
            detail: "string",
            documentation: "Absolute path to the program.",
        });
        const port = items.find((i) => i.label === "port");
        expect(port).toMatchObject({ detail: "number | string", documentation: "The **port**." });
        expect(items.find((i) => i.label === "internalConsoleOptions")?.detail).toBeUndefined();
    });

    it("skips attributes already set, doNotSuggest and malformed ones", () => {
        const { labels } = complete('{ "configurations": [ { "type": "synthetic", "program": "a", | } ] }');
        expect(labels).not.toContain("type");
        expect(labels).not.toContain("program");
        expect(labels).not.toContain("hiddenOne");
        expect(labels).not.toContain("malformed");
    });
});

describe("provideLaunchCompletions — values of an attribute", () => {
    const value = (attribute: string, at = "|") =>
        complete(`{ "configurations": [ { "type": "synthetic", "${attribute}": ${at} } ] }`);

    it("`type` → the registered debuggers with their labels, not deprecated or label-less ones", () => {
        const { items } = complete('{ "configurations": [ { "type": | } ] }');
        expect(items.map((i) => [i.label, i.documentation])).toEqual([['"synthetic"', "Synthetic Debug"]]);
        expect(items[0]).toMatchObject({ kind: "value", insertText: '"synthetic"' });
    });

    it("`request` → the debugger's requests; without a debugger, launch and attach", () => {
        expect(value("request").labels).toEqual(['"launch"', '"attach"']);
        expect(complete('{ "configurations": [ { "request": | } ] }').labels).toEqual(['"launch"', '"attach"']);
    });

    it("a boolean attribute → true/false, the default marked", () => {
        const { items } = value("stopOnEntry");
        expect(items.map((i) => [i.label, i.detail])).toEqual([
            ["true", undefined],
            ["false", "default"],
        ]);
        expect(items[0].documentation).toBe("Stop after launch.");
    });

    it("an enum attribute → its values with their descriptions", () => {
        const { items } = value("trace");
        expect(items.map((i) => [i.label, i.documentation, i.detail])).toEqual([
            ['"off"', "No trace.", "default"],
            ['"verbose"', "Everything.", undefined],
        ]);
        expect(value("internalConsoleOptions").items[0].documentation).toBe(
            "Controls when the internal Debug Console should open.",
        );
    });

    it("an attribute with a default only → the default; with nothing → nothing", () => {
        expect(value("port").labels).toEqual(["9229"]);
        expect(value("program").labels).toEqual([]);
        expect(value("unknown").labels).toEqual([]);
    });

    it("a typed string value is replaced with its quotes", () => {
        const { items, text } = value("trace", '"v|"');
        const { start, end } = items[1].replaceRange;
        expect(text.slice(start, end)).toBe('"v"');
    });
});

describe("provideLaunchCompletions — configuration snippets", () => {
    it("in place of a configuration: every debugger's snippets", () => {
        const { items } = complete('{ "configurations": [ | ] }');
        expect(items.map((i) => i.label)).toEqual(["Synthetic: Launch", "Synthetic: Extra"]);
        expect(items[0]).toMatchObject({
            kind: "snippet",
            documentation: "A new launch configuration.",
            insertText:
                '{\n\t"type": "synthetic",\n\t"request": "launch",\n\t"name": "Launch",\n\t"program": "\\${file}"\n}',
        });
    });

    it("indents the lines after the first one from the caret's line, in the editor's unit", () => {
        const text = '{\n  "configurations": [\n    \n  ]\n}';
        const offset = text.indexOf("    \n") + 4;
        const [item] = provideLaunchCompletions(text, offset, [[]], [OTHER], "  ");
        expect(item.insertText).toBe('{\n      "type": "synthetic"\n    }');

        const inline = '{ "configurations": [ ';
        const [first] = provideLaunchCompletions(`${inline} ] }`, inline.length, [[]], [OTHER]);
        expect(first.insertText).toBe('{\n\t"type": "synthetic"\n}');
    });

    it("adds a comma before the next configuration", () => {
        expect(complete('{ "configurations": [ |{ "type": "x" } ] }').items[0].insertText).toMatch(/\},$/);
        expect(complete('{ "configurations": [ | ] }').items[0].insertText).toMatch(/\}$/);
        expect(complete('{ "configurations": [ |, {} ] }').items[0].insertText).toMatch(/\}$/);
        // A string or an array in its place is a configuration being typed, too; nothing after the caret — no comma.
        expect(complete('{ "configurations": [ | "x" ] }').items[0].insertText).toMatch(/\},$/);
        expect(complete('{ "configurations": [ | [] ] }').items[0].insertText).toMatch(/\},$/);
        expect(complete('{ "configurations": [ |').items[0].insertText).toMatch(/\}$/);
    });

    it("no debuggers → nothing", () => {
        expect(complete('{ "configurations": [ | ] }', [[]], []).items).toEqual([]);
    });
});

describe("snippetText", () => {
    it("pretty-prints with tabs, nested and empty containers", () => {
        expect(snippetText({ a: [1, { b: null }], c: {}, d: [] })).toBe(
            '{\n\t"a": [\n\t\t1,\n\t\t{\n\t\t\t"b": null\n\t\t}\n\t],\n\t"c": {},\n\t"d": []\n}',
        );
    });

    it("a `^` string goes in raw, the rest as JSON", () => {
        expect(snippetText({ port: "^${1:9229}", name: "${2:Launch}" })).toBe(
            '{\n\t"port": ${1:9229},\n\t"name": "${2:Launch}"\n}',
        );
    });
});
