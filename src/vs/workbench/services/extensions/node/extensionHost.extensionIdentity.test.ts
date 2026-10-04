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
 * Своё `vscode` у каждого расширения (G7) — настоящий субпроцесс.
 *
 * Расширения лежат в РАЗНЫХ каталогах (`extensionPath`), как установленные из
 * магазина: по корню субпроцесс узнаёт, чей модуль импортирует `"vscode"`.
 * Сравнения идут внутри субпроцесса (объекты по проводу не сравнить) — их
 * делает команда фикстуры «beta» и отдаёт отчёт.
 *
 * Оба loader'а: `"node"` — родные хуки Node без tsx (виден настоящий резолв
 * ESM), `"tsx"` — дефолт остальных тестов (tsx в цепочке хуков раньше нашего).
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

/** Builtin: исходник в памяти под синтетическим путём, которого нет на диске. */
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
    readonly sameWorkspace: boolean;
    readonly activeFile: string | null;
}

interface IReport {
    readonly distinct: boolean;
    readonly distinctCommands: boolean;
    readonly helperSame: boolean;
    readonly samePosition: boolean;
    readonly sameWorkspace: boolean;
    readonly activeAlpha: string | null;
    readonly activeBeta: string | null;
    readonly esm: IComparison | null;
    readonly builtin: IComparison | null;
}

const LOADERS: readonly SubprocessLoader[] = ["node", "tsx"];

for (const loader of LOADERS) {
    describe(`ExtensionHost — своё vscode у каждого расширения (loader: ${loader})`, () => {
        it("CJS, ESM и builtin получают разные объекты с общими value-типами и живыми геттерами", async () => {
            const harness = await createExtensionTestHarness({
                subprocessLoader: loader,
                extensions: [
                    registration("alpha", "extension.cjs"),
                    registration("esm", "extension.mjs"),
                    builtinRegistration(),
                    // Последней: её команда читает пробы остальных.
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
                    sameWorkspace: true,
                    activeAlpha: first,
                    activeBeta: first,
                    esm: { distinctWindow: true, samePosition: true, sameWorkspace: true, activeFile: first },
                    builtin: { distinctWindow: true, samePosition: true, sameWorkspace: true, activeFile: first },
                });

                // Геттер читается на каждом обращении, а не снимается при сборке оверлея.
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
