import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    EXTENSION_FIXTURES_DIR,
    type SubprocessLoader,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";

import type { IExtensionRegistration } from "./iExtensionEntry.ts";

/**
 * The extensions live in DIFFERENT directories: by the root the subprocess tells whose module
 * imports `"vscode"`. The comparisons happen inside the subprocess (objects cannot be compared
 * over the wire); the fixture's "beta" command does them. Loader `"node"` runs without tsx, so the
 * real ESM resolution is visible.
 */

const DIR = path.join(EXTENSION_FIXTURES_DIR, "extensionIdentity");

function registration(name: string, main: string, type?: string): IExtensionRegistration {
    const extensionPath = path.join(DIR, name);
    return {
        id: `test.identity.${name}`,
        manifest: { name, publisher: "test", version: "0.0.1", ...(type === undefined ? {} : { type }) },
        mainPath: path.join(extensionPath, main),
        extensionPath,
        activationEvents: ["*"],
    };
}

function builtinRegistration(): IExtensionRegistration {
    return {
        id: "test.identity.builtin",
        manifest: { name: "builtin", publisher: "test", version: "0.0.1" },
        source: fs.readFileSync(path.join(DIR, "builtin", "main.cjs"), "utf8"),
        filename: "/diode-builtin-identity/dist/main.js",
        activationEvents: ["*"],
    };
}

interface IComparison {
    readonly distinctWindow: boolean;
    readonly samePosition: boolean;
    readonly sameEnv: boolean;
    readonly activeFile: string | null;
}

interface IReport {
    readonly distinct: boolean;
    readonly distinctCommands: boolean;
    readonly helperSame: boolean;
    readonly samePosition: boolean;
    readonly sameEnv: boolean;
    readonly activeAlpha: string | null;
    readonly activeBeta: string | null;
    readonly esm: IComparison | null;
    readonly builtin: IComparison | null;
}

const LOADERS: readonly SubprocessLoader[] = ["node", "tsx"];

for (const loader of LOADERS) {
    describe(`ExtensionHost — each extension gets its own vscode (loader: ${loader})`, () => {
        it("CJS, ESM and builtin get distinct objects with shared value types and live getters", async () => {
            const harness = await createExtensionTestHarness({
                subprocessLoader: loader,
                extensions: [
                    registration("alpha", "extension.cjs"),
                    registration("esm", "extension.mjs"),
                    builtinRegistration(),
                    // Last: its command reads the probes of the others.
                    registration("beta", "extension.cjs"),
                ],
            });
            try {
                const first = harness.writeFile("first.txt", "one\n");
                harness.group.openFile(first);
                await settle();
                const report = (await harness.commandRegistry.execute("test.identity.report")) as IReport;
                expect(report).toEqual({
                    distinct: true,
                    distinctCommands: true,
                    helperSame: true,
                    samePosition: true,
                    sameEnv: true,
                    activeAlpha: first,
                    activeBeta: first,
                    esm: { distinctWindow: true, samePosition: true, sameEnv: true, activeFile: first },
                    builtin: { distinctWindow: true, samePosition: true, sameEnv: true, activeFile: first },
                });

                // The getter is read on every access, not captured when the overlay is built.
                const second = harness.writeFile("second.txt", "two\n");
                harness.group.openFile(second);
                await settle();
                const after = (await harness.commandRegistry.execute("test.identity.report")) as IReport;
                expect([after.activeAlpha, after.activeBeta, after.esm?.activeFile, after.builtin?.activeFile]).toEqual(
                    [second, second, second, second],
                );
            } finally {
                await harness.dispose();
            }
        });
    });
}
