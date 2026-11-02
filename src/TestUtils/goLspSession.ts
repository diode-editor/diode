import * as fs from "node:fs";
import * as path from "node:path";

import { Uri } from "../vs/base/common/uri.ts";
import type { IDefinitionRequest } from "../vs/editor/common/languages/iDefinitionSource.ts";

import { CLIENT_CRASH_PATTERNS } from "./basedpyrightFixture.ts";
import { createExtensionTestHarness, documentVersion, type IExtensionHarness } from "./ExtensionTestHarness.ts";
import { GO_LANGUAGE_SERVICE, goSampleFiles, type IInstalledGo } from "./goFixture.ts";
import { waitUntil } from "./timing.ts";

type GoEditor = NonNullable<ReturnType<IExtensionHarness["group"]["getActiveEditor"]>>;

export interface IGoLspSession {
    readonly harness: IExtensionHarness;
    readonly editor: GoEditor;
    /** The position of `needle` in the open file, `offset` characters into it. */
    at(needle: string, offset?: number): IDefinitionRequest;
    uriOf(name: string): string;
    /** What the language client complained about in OUTPUT: stays empty when its own calls get data. */
    clientCrashes(): readonly string[];
    frame(): string;
}

/** Stock golang.go with gopls over a copy of `goSample`, `file` open; ready when the client has registered with the server. */
export async function openGoFile(
    installed: IInstalledGo,
    gopls: string,
    file: string,
    goplsSettings: Readonly<Record<string, unknown>> = {},
): Promise<IGoLspSession> {
    const output: string[] = [];
    const harness = await createExtensionTestHarness({
        languageService: GO_LANGUAGE_SERVICE,
        activateEvents: [],
        configuration: { go: { alternateTools: { gopls } }, gopls: goplsSettings },
        outputSink: { append: (_channel, _label, _level, value) => output.push(value), show: () => undefined },
        extensions: [installed.registration],
    });
    for (const [name, text] of Object.entries(goSampleFiles())) {
        fs.mkdirSync(path.dirname(path.join(harness.tmpDir, name)), { recursive: true });
        harness.writeFile(name, text);
    }
    const filePath = path.join(harness.tmpDir, file);
    harness.group.openFile(filePath);
    const editor = harness.group.getActiveEditor();
    if (editor === null) throw new Error("no active editor");
    await harness.host.activateByEvent("onLanguage:go");
    await waitUntil("gopls registered", () => harness.languageFeatures.definitionProvider.has(editor), 120_000);
    const uri = Uri.file(filePath).toString();
    return {
        harness,
        editor,
        at: (needle, offset = 0) => {
            const lines = editor.getText().split("\n");
            const line = lines.findIndex((text) => text.includes(needle));
            if (line < 0) throw new Error(`"${needle}" is not in ${file}`);
            return {
                uri,
                languageId: "go",
                versionId: documentVersion(harness, uri),
                line,
                character: lines[line].indexOf(needle) + offset,
            };
        },
        uriOf: (name) => Uri.file(path.join(harness.tmpDir, name)).toString(),
        clientCrashes: () => output.filter((line) => CLIENT_CRASH_PATTERNS.test(line)),
        frame: () => {
            harness.app.render();
            return harness.app.backend.screenToString();
        },
    };
}
