import * as fs from "node:fs";
import * as path from "node:path";

import { expect } from "vitest";

import { Uri } from "../vs/base/common/uri.ts";
import type { WireMarker } from "../vs/workbench/api/common/wireTypes.ts";

import {
    ANGULAR_LANGUAGE_SERVICE,
    angularSampleFiles,
    type IInstalledAngular,
    linkAngularLibrary,
} from "./angularFixture.ts";
import { CLIENT_CRASH_PATTERNS, until } from "./basedpyrightFixture.ts";
import {
    activatingLanguageService,
    createExtensionTestHarness,
    documentVersion,
    type IExtensionHarness,
    type IExtensionHarnessOptions,
} from "./ExtensionTestHarness.ts";

export const HELLO_HTML = "src/app/hello.component.html";
export const HELLO_TS = "src/app/hello.component.ts";
export const APP_TS = "src/app/app.component.ts";

interface IAngularPosition {
    readonly uri: string;
    readonly languageId: string;
    readonly versionId: number;
    readonly line: number;
    readonly character: number;
}

export interface IAngularSession {
    readonly harness: IExtensionHarness;
    activeEditor(): NonNullable<ReturnType<IExtensionHarness["group"]["getActiveEditor"]>>;
    uriOf(name: string): string;
    /** Opens `name` in the editor (it becomes the active one). */
    open(name: string): void;
    /** The position of `needle` in the open file `name`, `offset` characters into it. */
    at(name: string, needle: string, offset?: number): IAngularPosition;
    /** The last markers the extension published for `name`, once one of them says `message`. */
    markerSaying(name: string, message: string): Promise<WireMarker>;
    frameHas(...texts: readonly string[]): Promise<void>;
}

/** What the server reports once the project is loaded and the client knows the file is an Angular one. */
const READY_MARKER = { [HELLO_HTML]: "missingProp", [APP_TS]: "nope" } as const;

export interface IAngularSessionOptions extends Pick<IExtensionHarnessOptions, "configuration" | "extensions"> {
    /** The file opened first, `hello.component.html` by default. */
    readonly entry?: keyof typeof READY_MARKER;
}

/**
 * Writes the sample with the Angular library linked in, opens the entry file and activates the extensions the way
 * its language does. As in the app, a model of a language, the extension host's documents without one included,
 * activates `onLanguage:<id>`. The session starts once the server reports the entry's unknown name. A converter
 * crash in the output fails the test. `options` registers more extensions next to Angular (the built-in HTML
 * language features).
 */
export async function withAngularProject(
    installed: IInstalledAngular,
    nodeModules: string,
    run: (session: IAngularSession) => Promise<void>,
    options: IAngularSessionOptions = {},
): Promise<void> {
    const files = angularSampleFiles();
    const output: string[] = [];
    const published = new Map<string, readonly WireMarker[]>();
    const harness = await createExtensionTestHarness({
        languageService: activatingLanguageService(ANGULAR_LANGUAGE_SERVICE),
        activateEvents: [],
        diagnosticsSink: (_owner, resource, markers) => published.set(resource, markers),
        outputSink: {
            append: (_channel, _label, _level, value) => output.push(value),
            /* v8 ignore start -- test helper: the server's channel is read here, nothing asks to reveal it */
            show: () => undefined,
            /* v8 ignore stop */
        },
        configuration: options.configuration,
        extensions: [installed.registration, ...(options.extensions ?? [])],
    });
    try {
        linkAngularLibrary(harness.tmpDir, nodeModules);
        for (const [name, content] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(harness.tmpDir, name)), { recursive: true });
            harness.writeFile(name, content);
        }
        const uriOf = (name: string): string => Uri.file(path.join(harness.tmpDir, name)).toString();
        const open = (name: string): void => {
            harness.group.openFile(path.join(harness.tmpDir, name));
        };
        const markerSaying = (name: string, message: string): Promise<WireMarker> =>
            until(`"${message}" in ${name}`, () =>
                Promise.resolve(published.get(uriOf(name))?.find((marker) => marker.message.includes(message)) ?? null),
            );
        const entry = options.entry ?? HELLO_HTML;
        open(entry);
        await markerSaying(entry, READY_MARKER[entry]);
        await run({
            harness,
            activeEditor: () => {
                const editor = harness.group.getActiveEditor();
                /* v8 ignore start -- test helper: a template is open before `run` starts */
                if (editor === null) throw new Error("no active editor");
                /* v8 ignore stop */
                return editor;
            },
            uriOf,
            open,
            at: (name, needle, offset = 0) => {
                const lines = files[name].split("\n");
                const line = lines.findIndex((text) => text.includes(needle));
                /* v8 ignore start -- test helper: a needle that is not in the file is a mistake in the test */
                if (line < 0) throw new Error(`"${needle}" is not in ${name}`);
                /* v8 ignore stop */
                const uri = uriOf(name);
                return {
                    uri,
                    languageId: name.endsWith(".html") ? "html" : "typescript",
                    versionId: documentVersion(harness, uri),
                    line,
                    character: lines[line].indexOf(needle) + offset,
                };
            },
            markerSaying,
            frameHas: async (...texts) => {
                await until(texts.join(" + "), () => {
                    harness.app.render();
                    const screen = harness.app.backend.screenToString();
                    return texts.every((text) => screen.includes(text)) ? true : null;
                });
            },
        });
        expect(output.filter((line) => CLIENT_CRASH_PATTERNS.test(line))).toEqual([]);
    } finally {
        await harness.dispose();
    }
}
