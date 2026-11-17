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
import { createExtensionTestHarness, documentVersion, type IExtensionHarness } from "./ExtensionTestHarness.ts";

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

/**
 * Writes the sample with the Angular library linked in, opens `hello.component.html` and activates the extension
 * the way an `.html` file does. The session starts once the server reports `missingProp` in the template: the
 * project is loaded and the client knows it is an Angular one. A converter crash in the output fails the test.
 */
export async function withAngularProject(
    installed: IInstalledAngular,
    nodeModules: string,
    run: (session: IAngularSession) => Promise<void>,
): Promise<void> {
    const files = angularSampleFiles();
    const output: string[] = [];
    const published = new Map<string, readonly WireMarker[]>();
    const harness = await createExtensionTestHarness({
        languageService: ANGULAR_LANGUAGE_SERVICE,
        activateEvents: [],
        diagnosticsSink: (_owner, resource, markers) => published.set(resource, markers),
        outputSink: {
            append: (_channel, _label, _level, value) => output.push(value),
            /* v8 ignore start -- test helper: the server's channel is read here, nothing asks to reveal it */
            show: () => undefined,
            /* v8 ignore stop */
        },
        extensions: [installed.registration],
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
        open(HELLO_HTML);
        await harness.host.activateByEvent("onLanguage:html");
        await markerSaying(HELLO_HTML, "missingProp");
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
                    languageId: ANGULAR_LANGUAGE_SERVICE.getLanguageIdForResource(name) ?? "",
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
