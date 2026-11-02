import * as path from "node:path";

import { expect } from "vitest";

import type { InMemoryConfigurationService } from "../vs/platform/configuration/common/inMemoryConfigurationService.ts";

import {
    CLIENT_CRASH_PATTERNS,
    type IInstalledBasedpyright,
    PY_LANGUAGE_SERVICE,
    until,
} from "./basedpyrightFixture.ts";
import { createExtensionTestHarness, type IExtensionHarness } from "./ExtensionTestHarness.ts";
import { createTestConfigurationService } from "./testConfigurationService.ts";

export interface IPythonSession {
    readonly harness: IExtensionHarness;
    /** The core's settings; the extension reads its own from `harness.extensionConfiguration`. */
    readonly configuration: InMemoryConfigurationService;
    readonly output: readonly string[];
    activeEditor(): NonNullable<ReturnType<IExtensionHarness["group"]["getActiveEditor"]>>;
    frame(): string;
    frameHas(...texts: readonly string[]): Promise<void>;
}

/** Writes `files`, opens `main.py` and activates the server; a converter crash in the output fails the test. */
export async function withPythonFiles(
    installed: IInstalledBasedpyright,
    files: Readonly<Record<string, string>>,
    run: (session: IPythonSession) => Promise<void>,
    settings: Readonly<Record<string, unknown>> = {},
): Promise<void> {
    const output: string[] = [];
    const configuration = createTestConfigurationService(settings);
    const harness = await createExtensionTestHarness({
        languageService: PY_LANGUAGE_SERVICE,
        activateEvents: [],
        configurationService: configuration,
        outputSink: {
            append: (_channel, _label, _level, value) => output.push(value),
            show: () => undefined,
        },
        extensions: [installed.registration],
    });
    try {
        for (const [name, content] of Object.entries(files)) harness.writeFile(name, content);
        harness.group.openFile(path.join(harness.tmpDir, "main.py"));
        await harness.host.activateByEvent("onLanguage:python");
        const frame = (): string => {
            harness.app.render();
            return harness.app.backend.screenToString();
        };
        await run({
            harness,
            configuration,
            output,
            activeEditor: () => {
                const editor = harness.group.getActiveEditor();
                if (editor === null) throw new Error("no active editor");
                return editor;
            },
            frame,
            frameHas: async (...texts) => {
                await until(texts.join(" + "), () => {
                    const screen = frame();
                    return texts.every((text) => screen.includes(text)) ? true : null;
                });
            },
        });
        expect(output.filter((line) => CLIENT_CRASH_PATTERNS.test(line))).toEqual([]);
    } finally {
        await harness.dispose();
    }
}
