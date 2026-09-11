import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    EXTENSION_FIXTURES_DIR,
    extensionFixture,
    registerAndActivate,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";

interface IContextReport {
    extensionPath: string;
    extensionUriFsPath: string;
    extensionMode: number;
    isProduction: boolean;
    serverPath: string;
    envExtensionHost: string | null;
    envRunAsNode: string | null;
    pylance: unknown;
    allExtensions: unknown[];
}

// Расширение из in-memory source (builtin): extensionPath у регистрации нет —
// subprocess берёт каталог синтетического filename.
const SOURCE = `
const vscode = require("vscode");
exports.activate = function activate(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand("test.inmem.context", function () {
            return { extensionPath: context.extensionPath, serverPath: context.asAbsolutePath("dist/server.js") };
        }),
    );
};
`;

describe("ExtensionHost — ExtensionContext стороннего расширения", () => {
    it("context строится из extensionPath регистрации: пути, asAbsolutePath, Production-режим", async () => {
        const harness = await createExtensionTestHarness();
        try {
            // extensionPath намеренно НЕ равен каталогу mainPath: проверяем, что
            // context берёт значение хоста, а не выводит его из main-модуля.
            await registerAndActivate(harness.host, {
                ...extensionFixture("test.context", "reportsContext.cjs"),
                extensionPath: harness.tmpDir,
            });
            const report = (await harness.commandRegistry.execute("test.context.report")) as IContextReport;
            expect(report.extensionPath).toBe(harness.tmpDir);
            expect(report.extensionUriFsPath).toBe(harness.tmpDir);
            // asAbsolutePath — так basedpyright находит вшитый сервер в установке.
            expect(report.serverPath).toBe(path.join(harness.tmpDir, "dist", "server.js"));
            expect(report.extensionMode).toBe(1);
            // Сравнение с runtime-enum'ом (typeof-идентичность через require("vscode")).
            expect(report.isProduction).toBe(true);
        } finally {
            await harness.dispose();
        }
    });

    it("без extensionPath (фикстурная регистрация) — фолбэк на каталог main-модуля", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.context", "reportsContext.cjs")],
        });
        try {
            const report = (await harness.commandRegistry.execute("test.context.report")) as IContextReport;
            expect(report.extensionPath).toBe(EXTENSION_FIXTURES_DIR);
        } finally {
            await harness.dispose();
        }
    });

    it("in-memory source (builtin): фолбэк на каталог синтетического filename", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [
                {
                    id: "test.inmemory",
                    manifest: { name: "inmemory", publisher: "test", version: "0.0.1" },
                    source: SOURCE,
                    filename: "/diode/builtin/test.inmemory/out/extension.cjs",
                },
            ],
        });
        try {
            const report = (await harness.commandRegistry.execute("test.inmem.context")) as {
                extensionPath: string;
                serverPath: string;
            };
            expect(report.extensionPath).toBe("/diode/builtin/test.inmemory/out");
            expect(report.serverPath).toBe("/diode/builtin/test.inmemory/out/dist/server.js");
        } finally {
            await harness.dispose();
        }
    });

    it("наивный vscode.extensions: getExtension → undefined, all — пустой", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.context", "reportsContext.cjs")],
        });
        try {
            const report = (await harness.commandRegistry.execute("test.context.report")) as IContextReport;
            // pyright-семейство детектит Pylance через getExtension — честный
            // undefined (сериализованный в null через RPC) вместо TypeError.
            expect(report.pylance).toBeNull();
            expect(report.allExtensions).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });

    it("окружение детей субпроцесса: DIODE_EXTENSION_HOST снят, DIODE_RUN_AS_NODE=1", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.context", "reportsContext.cjs")],
        });
        try {
            const report = (await harness.commandRegistry.execute("test.context.report")) as IContextReport;
            // Иначе fork(process.execPath) из расширения под SEA ушёл бы в
            // ext-host-ветку diode-бинаря (exit 2) вместо node-режима.
            expect(report.envExtensionHost).toBeNull();
            expect(report.envRunAsNode).toBe("1");
        } finally {
            await harness.dispose();
        }
    });
});
