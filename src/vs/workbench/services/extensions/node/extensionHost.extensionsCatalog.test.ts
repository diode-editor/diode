import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    EXTENSION_FIXTURES_DIR,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";

import type { IExtensionRegistration } from "./iExtensionEntry.ts";

/** Что фикстура `inspectsExtensions.cjs` рассказывает про одно расширение. */
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

/** Расширение-обозреватель: зовёт `getExtension` уже в activate(). */
function inspector(): IExtensionRegistration {
    return {
        ...extensionFixture("test.inspector", "inspectsExtensions.cjs"),
        manifest: {
            name: "inspector",
            publisher: "test",
            version: "0.0.1",
            displayName: "Каталог-обозреватель",
            categories: ["Programming Languages"],
        },
    };
}

/** Сосед без кода событий активации — просто ещё одна запись в каталоге. */
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

describe("ExtensionHost — каталог vscode.extensions", () => {
    it("getExtension отдаёт настоящую запись уже в activate()", async () => {
        await withHarness([inspector()], async (harness) => {
            const self = (await harness.commandRegistry.execute("test.extensions.selfAtActivate")) as IExtensionReport;
            expect(self.id).toBe("test.inspector");
            expect(self.extensionPath).toBe(EXTENSION_FIXTURES_DIR);
            expect(self.extensionUriFsPath).toBe(EXTENSION_FIXTURES_DIR);
            expect(self.packageJSONName).toBe("inspector");
            // Манифест едет целиком, а не тройкой имя/издатель/версия.
            expect(self.packageJSONDisplayName).toBe("Каталог-обозреватель");
            // Без удалённого extension host'а kind по контракту всегда UI.
            expect(self.extensionKind).toBe(1);
            expect(self.isUiKind).toBe(true);
        });
    });

    it("all перечисляет все зарегистрированные расширения, а не только активные", async () => {
        // `onCommand:...` не наступает — сосед останется зарегистрированным, но
        // неактивным; каталог обязан показать и его.
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

    it("isActive поднимается, когда сосед действительно активируется", async () => {
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

    it("getExtension не привередлив к регистру id (как ExtensionIdentifier в эталоне)", async () => {
        await withHarness([inspector()], async (harness) => {
            const found = (await harness.commandRegistry.execute(
                "test.extensions.get",
                "Test.Inspector",
            )) as IExtensionReport | null;
            expect(found?.id).toBe("test.inspector");
        });
    });

    it("незнакомый id — по-прежнему честный undefined", async () => {
        await withHarness([inspector()], async (harness) => {
            expect(await harness.commandRegistry.execute("test.extensions.get", "ms-python.python")).toBeNull();
        });
    });

    it("exports активного расширения доступны соседу", async () => {
        await withHarness([inspector()], async (harness) => {
            const self = (await harness.commandRegistry.execute(
                "test.extensions.get",
                "test.inspector",
            )) as IExtensionReport;
            expect(self.exports).toEqual({ hello: "from inspector" });
        });
    });

    it("activate() у активного расширения отдаёт его exports, у спящего — честный отказ", async () => {
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

    it("onDidChange стреляет на смену СОСТАВА, но не на активацию", async () => {
        const late: IExtensionRegistration = {
            ...neighbour("test.late"),
            activationEvents: ["onLanguage:python"],
        };
        await withHarness([inspector(), late], async (harness) => {
            // Семя каталога на handshake слушателей ещё не застаёт.
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

    it("builtin из in-memory source получает extensionPath каталога своего filename", async () => {
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
