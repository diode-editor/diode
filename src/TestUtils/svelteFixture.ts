import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { expect } from "vitest";

import { Uri } from "../vs/base/common/uri.ts";
import { type ILanguageService, NULL_LANGUAGE_SERVICE } from "../vs/editor/common/languages/iLanguageService.ts";
import type { InMemoryConfigurationService } from "../vs/platform/configuration/common/inMemoryConfigurationService.ts";
import { installVsix } from "../vs/platform/extensionManagement/node/extensionInstaller.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";

import { CLIENT_CRASH_PATTERNS, until } from "./basedpyrightFixture.ts";
import {
    createExtensionTestHarness,
    documentVersion,
    type IExtensionHarness,
    provideHovers,
} from "./ExtensionTestHarness.ts";
import { registrationFromInstalled } from "./installedExtensionRegistration.ts";
import { fetchStockVsix } from "./stockVsix.ts";
import { createTestConfigurationService } from "./testConfigurationService.ts";

/** The language server, the Svelte compiler and TypeScript are bundled: nothing else to install. */
export const SVELTE_ID = "svelte.svelte-vscode";

export const SVELTE_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) =>
        filePath.endsWith(".svelte") ? "svelte" : filePath.endsWith(".ts") ? "typescript" : undefined,
};

/** Lines are 0-based: `greet(user)` — 13, `<Button` — 14, `unknownVar` — 15. */
export const APP_SVELTE = [
    '<script lang="ts">',
    '    import Button from "./Button.svelte";',
    '    import { greet, type User } from "./util";',
    "",
    "    let count = 0;",
    '    let user: User = { name: "Ann" };',
    "    function increment() {",
    "        count += 1;",
    "    }",
    "</script>",
    "",
    "<main>",
    "    <h1>{greet(user)}</h1>",
    '    <Button label="Add" on:click={increment} />',
    "    <p>{count} {unknownVar}</p>",
    "</main>",
    "",
].join("\n");

export const BUTTON_SVELTE = '<script lang="ts">\n    export let label: string;\n</script>\n\n<button on:click>{label}</button>\n';

export const UTIL_TS = [
    "export interface User {",
    "    name: string;",
    "}",
    "",
    "export function greet(user: User): string {",
    "    return `Hello, ${user.name}`;",
    "}",
    "",
].join("\n");

export const TSCONFIG_JSON = JSON.stringify({
    compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "bundler", strict: true },
    include: ["**/*.ts", "**/*.svelte"],
});

export const SVELTE_FILES: Readonly<Record<string, string>> = {
    "App.svelte": APP_SVELTE,
    "Button.svelte": BUTTON_SVELTE,
    "util.ts": UTIL_TS,
    "tsconfig.json": TSCONFIG_JSON,
};

export interface IInstalledSvelte {
    readonly registration: IExtensionRegistration;
    dispose(): void;
}

export async function installSvelte(): Promise<IInstalledSvelte> {
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-vsix-"));
    const { id, version } = await installVsix((await fetchStockVsix(SVELTE_ID)).vsixPath, extensionsDir);
    return {
        registration: await registrationFromInstalled(extensionsDir, id, version),
        dispose: (): void => {
            fs.rmSync(extensionsDir, { recursive: true, force: true });
        },
    };
}

export interface ISveltePosition {
    readonly uri: string;
    readonly languageId: string;
    readonly versionId: number;
    readonly line: number;
    readonly character: number;
}

export interface ISvelteSession {
    readonly harness: IExtensionHarness;
    readonly configuration: InMemoryConfigurationService;
    readonly output: readonly string[];
    activeEditor(): NonNullable<ReturnType<IExtensionHarness["group"]["getActiveEditor"]>>;
    uriOf(name: string): string;
    /** The position of `needle` in the open file `name`, `offset` characters into it. */
    at(name: string, needle: string, offset?: number): ISveltePosition;
    frame(): string;
    frameHas(...texts: readonly string[]): Promise<void>;
}

/**
 * Writes the files, opens `App.svelte` and activates the server: the session starts once the server answers a hover
 * with the type from `util.ts`, so the project is loaded. A converter crash in the output fails the test.
 * `settings` are what the extension reads (`harness.extensionConfiguration`), read at the start of the client.
 */
export async function withSvelteFiles(
    installed: IInstalledSvelte,
    run: (session: ISvelteSession) => Promise<void>,
    settings: Readonly<Record<string, unknown>> = {},
    files: Readonly<Record<string, string>> = SVELTE_FILES,
): Promise<void> {
    const output: string[] = [];
    const configuration = createTestConfigurationService({});
    const harness = await createExtensionTestHarness({
        languageService: SVELTE_LANGUAGE_SERVICE,
        activateEvents: [],
        configurationService: configuration,
        configuration: settings,
        outputSink: {
            append: (_channel, _label, _level, value) => output.push(value),
            /* v8 ignore start -- test helper: the server's channel is read here, nothing asks to reveal it */
            show: () => undefined,
            /* v8 ignore stop */
        },
        extensions: [installed.registration],
    });
    try {
        for (const [name, content] of Object.entries(files)) harness.writeFile(name, content);
        harness.group.openFile(path.join(harness.tmpDir, "App.svelte"));
        await harness.host.activateByEvent("onLanguage:svelte");
        const uriOf = (name: string): string => Uri.file(path.join(harness.tmpDir, name)).toString();
        const at = (name: string, needle: string, offset = 0): ISveltePosition => {
            const uri = uriOf(name);
            const lines = (files[name] ?? "").split("\n");
            const line = lines.findIndex((text) => text.includes(needle));
            /* v8 ignore start -- test helper: a needle that is not in the file is a mistake in the test */
            if (line < 0) throw new Error(`"${needle}" is not in ${name}`);
            /* v8 ignore stop */
            const languageId = name.endsWith(".svelte") ? "svelte" : "typescript";
            const versionId = documentVersion(harness, uri);
            return { uri, languageId, versionId, line, character: lines[line].indexOf(needle) + offset };
        };
        const frame = (): string => {
            harness.app.render();
            return harness.app.backend.screenToString();
        };
        await until("the hover over greet", async () => {
            const hovers = await provideHovers(harness, at("App.svelte", "greet(user)"));
            return hovers.some((hover) => hover.contents.join("\n").includes("User")) ? true : null;
        });
        await run({
            harness,
            configuration,
            output,
            activeEditor: () => {
                const editor = harness.group.getActiveEditor();
                /* v8 ignore start -- test helper: `App.svelte` is open before `run` starts */
                if (editor === null) throw new Error("no active editor");
                /* v8 ignore stop */
                return editor;
            },
            uriOf,
            at,
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
