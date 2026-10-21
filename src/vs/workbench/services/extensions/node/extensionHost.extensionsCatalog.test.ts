import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    EXTENSION_FIXTURES_DIR,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";

import type { IExtensionRegistration } from "./iExtensionEntry.ts";

interface IExtensionReport {
    id: string;
    extensionPath: string;
    extensionUriFsPath: string;
    isActive: boolean;
    extensionKind: number;
    isUiKind: boolean;
    packageJSONName: string;
    packageJSONDisplayName: string | undefined;
    exports: unknown;
}

function inspector(): IExtensionRegistration {
    return {
        ...extensionFixture("test.inspector", "inspectsExtensions.cjs"),
        manifest: {
            name: "inspector",
            publisher: "test",
            version: "0.0.1",
            displayName: "Catalog Inspector",
            categories: ["Programming Languages"],
        },
    };
}

function neighbour(id: string): IExtensionRegistration {
    return extensionFixture(id, "noopExtension.cjs");
}

async function withHarness(
    extensions: readonly IExtensionRegistration[],
    run: (harness: IExtensionHarness) => Promise<void>,
    activateEvents?: readonly string[],
): Promise<void> {
    const harness = await createExtensionTestHarness({
        extensions,
        ...(activateEvents !== undefined ? { activateEvents } : {}),
    });
    try {
        await run(harness);
    } finally {
        await harness.dispose();
    }
}

describe("ExtensionHost — vscode.extensions catalog", () => {
    it("getExtension returns the real entry already in activate()", async () => {
        await withHarness([inspector()], async (harness) => {
            const self = (await harness.commandRegistry.execute("test.extensions.selfAtActivate")) as IExtensionReport;
            expect(self.id).toBe("test.inspector");
            expect(self.extensionPath).toBe(EXTENSION_FIXTURES_DIR);
            expect(self.extensionUriFsPath).toBe(EXTENSION_FIXTURES_DIR);
            expect(self.packageJSONName).toBe("inspector");
            expect(self.packageJSONDisplayName).toBe("Catalog Inspector");
            // Without a remote extension host, kind is always UI by contract.
            expect(self.extensionKind).toBe(1);
            expect(self.isUiKind).toBe(true);
        });
    });

    it("all lists every registered extension, not only active ones", async () => {
        const sleeping: IExtensionRegistration = {
            ...neighbour("test.sleeping"),
            activationEvents: ["onCommand:never.happens"],
        };
        await withHarness([inspector(), sleeping], async (harness) => {
            const all = (await harness.commandRegistry.execute("test.extensions.all")) as IExtensionReport[];
            expect(all.map((e) => e.id)).toEqual(["test.inspector", "test.sleeping"]);
            expect(all.map((e) => e.isActive)).toEqual([true, false]);
        });
    });

    it("isActive turns on when the neighbour actually activates", async () => {
        const late: IExtensionRegistration = {
            ...neighbour("test.late"),
            activationEvents: ["onLanguage:python"],
        };
        await withHarness([inspector(), late], async (harness) => {
            const before = (await harness.commandRegistry.execute(
                "test.extensions.get",
                "test.late",
            )) as IExtensionReport;
            expect(before.isActive).toBe(false);
            await harness.host.activateByEvent("onLanguage:python");
            await harness.flushRpc(4);
            const after = (await harness.commandRegistry.execute(
                "test.extensions.get",
                "test.late",
            )) as IExtensionReport;
            expect(after.isActive).toBe(true);
        });
    });

    it("getExtension is case-insensitive on the id (like ExtensionIdentifier upstream)", async () => {
        await withHarness([inspector()], async (harness) => {
            const found = (await harness.commandRegistry.execute(
                "test.extensions.get",
                "Test.Inspector",
            )) as IExtensionReport | null;
            expect(found?.id).toBe("test.inspector");
        });
    });

    it("an unknown id still gives a plain undefined", async () => {
        await withHarness([inspector()], async (harness) => {
            expect(await harness.commandRegistry.execute("test.extensions.get", "ms-python.python")).toBeNull();
        });
    });

    it("an active extension's exports are available to a neighbour", async () => {
        await withHarness([inspector()], async (harness) => {
            const self = (await harness.commandRegistry.execute(
                "test.extensions.get",
                "test.inspector",
            )) as IExtensionReport;
            expect(self.exports).toEqual({ hello: "from inspector" });
        });
    });

    it("activate() on an active extension returns its exports, on a dormant one a plain rejection", async () => {
        const sleeping: IExtensionRegistration = {
            ...neighbour("test.sleeping"),
            activationEvents: ["onCommand:never.happens"],
        };
        await withHarness([inspector(), sleeping], async (harness) => {
            expect(
                await harness.commandRegistry.execute("test.extensions.activateNeighbour", "test.inspector"),
            ).toEqual({ ok: true, value: { hello: "from inspector" } });
            const refused = (await harness.commandRegistry.execute(
                "test.extensions.activateNeighbour",
                "test.sleeping",
            )) as { ok: boolean; error: string };
            expect(refused.ok).toBe(false);
            expect(refused.error).toContain("not implemented");
        });
    });

    it("onDidChange fires on a change of the SET, not on activation", async () => {
        const late: IExtensionRegistration = {
            ...neighbour("test.late"),
            activationEvents: ["onLanguage:python"],
        };
        await withHarness([inspector(), late], async (harness) => {
            expect(await harness.commandRegistry.execute("test.extensions.changeCount")).toBe(0);
            await harness.host.activateByEvent("onLanguage:python");
            await harness.flushRpc(4);
            expect(await harness.commandRegistry.execute("test.extensions.changeCount")).toBe(0);

            const added = harness.host.registerExtension(neighbour("test.added"));
            await harness.flushRpc(4);
            expect(await harness.commandRegistry.execute("test.extensions.changeCount")).toBe(1);
            const all = (await harness.commandRegistry.execute("test.extensions.all")) as IExtensionReport[];
            expect(all.map((e) => e.id)).toContain("test.added");

            added.dispose();
            await harness.flushRpc(4);
            expect(await harness.commandRegistry.execute("test.extensions.changeCount")).toBe(2);
            const afterRemoval = (await harness.commandRegistry.execute("test.extensions.all")) as IExtensionReport[];
            expect(afterRemoval.map((e) => e.id)).not.toContain("test.added");
        });
    });

    it("a builtin from an in-memory source gets the extensionPath of its filename's directory", async () => {
        const builtin: IExtensionRegistration = {
            id: "test.builtin",
            manifest: { name: "builtin", publisher: "test", version: "0.0.1" },
            source: "exports.activate = function () {};",
            filename: "/builtins/test.builtin/extension.cjs",
        };
        await withHarness([inspector(), builtin], async (harness) => {
            const found = (await harness.commandRegistry.execute(
                "test.extensions.get",
                "test.builtin",
            )) as IExtensionReport;
            expect(found.extensionPath).toBe(path.posix.dirname("/builtins/test.builtin/extension.cjs"));
        });
    });
});
