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
    selfAtActivate: {
        id: string;
        packageJSON: { name: string; publisher: string; version: string };
        extensionPath: string;
        isActive: boolean;
    };
    selfIsActiveNow: boolean;
}

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

describe("ExtensionHost — ExtensionContext of a third-party extension", () => {
    it("context is built from the registration extensionPath: paths, asAbsolutePath, Production mode", async () => {
        const harness = await createExtensionTestHarness();
        try {
            // extensionPath is intentionally NOT the mainPath directory.
            await registerAndActivate(harness.host, {
                ...extensionFixture("test.context", "reportsContext.cjs"),
                extensionPath: harness.tmpDir,
            });
            const report = (await harness.commandRegistry.execute("test.context.report")) as IContextReport;
            expect(report.extensionPath).toBe(harness.tmpDir);
            expect(report.extensionUriFsPath).toBe(harness.tmpDir);
            expect(report.serverPath).toBe(path.join(harness.tmpDir, "dist", "server.js"));
            expect(report.extensionMode).toBe(1);
            expect(report.isProduction).toBe(true);
        } finally {
            await harness.dispose();
        }
    });

    it("without extensionPath (fixture registration) it falls back to the main module directory", async () => {
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

    it("in-memory source (builtin): falls back to the directory of the synthetic filename", async () => {
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

    it("vscode.extensions: unknown id → undefined, all is what is actually registered", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.context", "reportsContext.cjs")],
        });
        try {
            const report = (await harness.commandRegistry.execute("test.context.report")) as IContextReport;
            // The pyright family detects Pylance via getExtension: undefined (null after RPC), not a TypeError.
            expect(report.pylance).toBeNull();
            expect((report.allExtensions as { id: string }[]).map((e) => e.id)).toEqual(["test.context"]);
        } finally {
            await harness.dispose();
        }
    });

    it("context.extension is the extension's own catalog entry: manifest, root, isActive", async () => {
        const harness = await createExtensionTestHarness();
        try {
            await registerAndActivate(harness.host, {
                ...extensionFixture("test.context", "reportsContext.cjs"),
                manifest: { name: "context", publisher: "test", version: "1.2.3" },
                extensionPath: harness.tmpDir,
            });
            const report = (await harness.commandRegistry.execute("test.context.report")) as IContextReport;
            // The bazel-java fork's telemetry reads `packageJSON` on the first line of activate().
            expect(report.selfAtActivate.id).toBe("test.context");
            expect(report.selfAtActivate.packageJSON).toEqual({ name: "context", publisher: "test", version: "1.2.3" });
            expect(report.selfAtActivate.extensionPath).toBe(report.extensionPath);
            // Like upstream `isActivated`: the entry is live, not a snapshot.
            expect(report.selfAtActivate.isActive).toBe(false);
            expect(report.selfIsActiveNow).toBe(true);
        } finally {
            await harness.dispose();
        }
    });

    it("subprocess children environment: DIODE_EXTENSION_HOST unset, DIODE_RUN_AS_NODE=1", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.context", "reportsContext.cjs")],
        });
        try {
            const report = (await harness.commandRegistry.execute("test.context.report")) as IContextReport;
            // Otherwise fork(process.execPath) from an extension under SEA would land in the
            // diode binary's extension host branch (exit 2) instead of node mode.
            expect(report.envExtensionHost).toBeNull();
            expect(report.envRunAsNode).toBe("1");
        } finally {
            await harness.dispose();
        }
    });
});
