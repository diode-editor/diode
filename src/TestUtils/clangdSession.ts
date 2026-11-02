import * as fs from "node:fs";
import * as path from "node:path";

import { afterAll, beforeAll, describe } from "vitest";

import { Uri } from "../vs/base/common/uri.ts";
import type { IDefinitionRequest } from "../vs/editor/common/languages/iDefinitionSource.ts";
import type { WireMarker } from "../vs/workbench/api/common/wireTypes.ts";

import { CLIENT_CRASH_PATTERNS, until } from "./basedpyrightFixture.ts";
import {
    clangdMissing,
    CPP_LANGUAGE_SERVICE,
    CPP_SAMPLE_DIR,
    findClangd,
    type IInstalledClangd,
    installClangd,
} from "./clangdFixture.ts";
import {
    createExtensionTestHarness,
    documentVersion,
    type IExtensionHarness,
    provideDocumentSymbols,
} from "./ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "./marketplaceEnv.ts";

type CppEditor = NonNullable<ReturnType<IExtensionHarness["group"]["getActiveEditor"]>>;

export interface IClangdSession {
    readonly harness: IExtensionHarness;
    readonly editor: CppEditor;
    /** The position of `needle` in the open file, `offset` characters into it. */
    at(needle: string, offset?: number): IDefinitionRequest;
    /** The messages of the latest diagnostics clangd published for `file`; `undefined` before the first. */
    diagnostics(file: string): readonly string[] | undefined;
    /** What the language client complained about in OUTPUT: stays empty when its own calls get data. */
    clientCrashes(): readonly string[];
    uriOf(file: string): string;
    frame(): string;
}

export interface IClangdSessionOptions {
    /** Opened before the activation; `main.cpp` by default. */
    readonly file?: string;
    readonly settings?: Readonly<Record<string, unknown>>;
    /** Runs after the sample is copied, before the server starts: a compilation database goes here. */
    readonly beforeServer?: (dir: string) => void;
}

/** Runs against a fresh copy of `cppSample`, with clangd already answering about the open file. */
export type WithCppFile = (
    run: (session: IClangdSession) => Promise<void>,
    options?: IClangdSessionOptions,
) => Promise<void>;

async function openSample(installed: IInstalledClangd, options: IClangdSessionOptions): Promise<IClangdSession> {
    const file = options.file ?? "main.cpp";
    const output: string[] = [];
    const published = new Map<string, readonly WireMarker[]>();
    const harness = await createExtensionTestHarness({
        languageService: CPP_LANGUAGE_SERVICE,
        activateEvents: [],
        configuration: { clangd: { path: findClangd(), ...options.settings } },
        diagnosticsSink: (_owner, resource, markers) => published.set(resource, markers),
        outputSink: { append: (_channel, _label, _level, value) => output.push(value), show: () => undefined },
        extensions: [installed.registration],
    });
    fs.cpSync(CPP_SAMPLE_DIR, harness.tmpDir, { recursive: true });
    options.beforeServer?.(harness.tmpDir);
    const uriOf = (name: string): string => Uri.file(path.join(harness.tmpDir, name)).toString();
    harness.group.openFile(path.join(harness.tmpDir, file));
    const editor = harness.group.getActiveEditor();
    if (editor === null) throw new Error("no active editor");
    await harness.host.activateByEvent("onLanguage:cpp");
    const at = (needle: string, offset = 0): IDefinitionRequest => {
        const lines = editor.getText().split("\n");
        const line = lines.findIndex((text) => text.includes(needle));
        if (line < 0) throw new Error(`"${needle}" is not in ${file}`);
        return {
            uri: uriOf(file),
            languageId: "cpp",
            versionId: documentVersion(harness, uriOf(file)),
            line,
            character: lines[line].indexOf(needle) + offset,
        };
    };
    // The outline comes from the parsed file: empty answers after this point are clangd's own.
    await until("clangd answering about the open file", async () => {
        const symbols = await provideDocumentSymbols(harness, at(""));
        return symbols.length > 0 ? symbols : null;
    });
    return {
        harness,
        editor,
        at,
        diagnostics: (name) => published.get(uriOf(name))?.map((marker) => marker.message),
        clientCrashes: () => output.filter((line) => CLIENT_CRASH_PATTERNS.test(line)),
        uriOf,
        frame: () => {
            harness.app.render();
            return harness.app.backend.screenToString();
        },
    };
}

/** A suite on the stock vscode-clangd with the machine's clangd, skipped without the marketplace or clangd. */
export function describeStockClangd(title: string, body: (withCppFile: WithCppFile) => void): void {
    const skipReason = clangdMissing();
    if (skipReason !== undefined) console.warn(skipReason);

    describe.skipIf(MARKETPLACE_OFFLINE || skipReason !== undefined)(title, () => {
        let installed: IInstalledClangd;

        beforeAll(async () => {
            installed = await installClangd();
        }, 120_000);

        afterAll(() => {
            installed.dispose();
        });

        body(async (run, options = {}) => {
            const session = await openSample(installed, options);
            try {
                await run(session);
            } finally {
                await session.harness.dispose();
            }
        });
    });
}
