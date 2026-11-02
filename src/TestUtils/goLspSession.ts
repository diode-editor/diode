import * as fs from "node:fs";
import * as path from "node:path";

import { afterAll, beforeAll, describe } from "vitest";

import { Uri } from "../vs/base/common/uri.ts";
import type { IDefinitionRequest } from "../vs/editor/common/languages/iDefinitionSource.ts";

import { CLIENT_CRASH_PATTERNS, until } from "./basedpyrightFixture.ts";
import {
    createExtensionTestHarness,
    documentVersion,
    type IExtensionHarness,
    provideDefinitions,
} from "./ExtensionTestHarness.ts";
import {
    ensureGopls,
    GO_LANGUAGE_SERVICE,
    goSampleFiles,
    goToolchainMissing,
    type IInstalledGo,
    installGo,
} from "./goFixture.ts";
import { MARKETPLACE_OFFLINE } from "./marketplaceEnv.ts";
import { waitUntil } from "./timing.ts";

type GoEditor = NonNullable<ReturnType<IExtensionHarness["group"]["getActiveEditor"]>>;

export interface IGoLspSession {
    readonly harness: IExtensionHarness;
    readonly editor: GoEditor;
    /** The position of `needle` in the open file, `offset` characters into it. */
    at(needle: string, offset?: number): IDefinitionRequest;
    /** What the language client complained about in OUTPUT: stays empty when its own calls get data. */
    clientCrashes(): readonly string[];
    frame(): string;
}

/** Runs against `greet/greeter.go` of a fresh copy of `goSample`, with gopls already answering about the package. */
export type WithGoFile = (
    run: (session: IGoLspSession) => Promise<void>,
    goplsSettings?: Readonly<Record<string, unknown>>,
) => Promise<void>;

const GREETER = "greet/greeter.go";

async function openGreeter(
    installed: IInstalledGo,
    gopls: string,
    goplsSettings: Readonly<Record<string, unknown>>,
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
    const filePath = path.join(harness.tmpDir, GREETER);
    harness.group.openFile(filePath);
    const editor = harness.group.getActiveEditor();
    if (editor === null) throw new Error("no active editor");
    await harness.host.activateByEvent("onLanguage:go");
    await waitUntil("gopls registered", () => harness.languageFeatures.definitionProvider.has(editor), 120_000);
    const uri = Uri.file(filePath).toString();
    const at = (needle: string, offset = 0): IDefinitionRequest => {
        const lines = editor.getText().split("\n");
        const line = lines.findIndex((text) => text.includes(needle));
        if (line < 0) throw new Error(`"${needle}" is not in ${GREETER}`);
        return {
            uri,
            languageId: "go",
            versionId: documentVersion(harness, uri),
            line,
            character: lines[line].indexOf(needle) + offset,
        };
    };
    // A cross-file answer means the package is loaded: empty answers after this point are gopls's own.
    await until("gopls answering about the package", async () => {
        const targets = await provideDefinitions(harness, at("Hello(e.Name)"));
        return targets.length > 0 ? targets : null;
    });
    return {
        harness,
        editor,
        at,
        clientCrashes: () => output.filter((line) => CLIENT_CRASH_PATTERNS.test(line)),
        frame: () => {
            harness.app.render();
            return harness.app.backend.screenToString();
        },
    };
}

/** A suite on stock golang.go with the real gopls, skipped without the marketplace or a Go toolchain. */
export function describeStockGo(title: string, body: (withGoFile: WithGoFile) => void): void {
    const skipReason = goToolchainMissing();
    if (skipReason !== undefined) console.warn(skipReason);

    describe.skipIf(MARKETPLACE_OFFLINE || skipReason !== undefined)(title, () => {
        let installed: IInstalledGo;
        let gopls: string;

        beforeAll(async () => {
            gopls = ensureGopls();
            installed = await installGo();
        }, 600_000);

        afterAll(() => {
            installed.dispose();
        });

        body(async (run, goplsSettings = {}) => {
            const session = await openGreeter(installed, gopls, goplsSettings);
            try {
                await run(session);
            } finally {
                await session.harness.dispose();
            }
        });
    });
}
