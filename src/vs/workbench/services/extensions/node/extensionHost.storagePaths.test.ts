import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";

import type { IExtensionStorageHomes } from "./extensionStoragePaths.ts";

interface IStorageReport {
    globalStorageFsPath: string;
    globalStorageScheme: string;
    globalStoragePath: string;
    storageFsPath: string | null;
    storagePath: string | null;
    logFsPath: string;
    logPath: string;
    logParentExists: boolean;
    logDirExists: boolean;
}

/** Фикстура, которая в activate() читает globalStorageUri и пишет в него файл. */
function storageFixture(id = "test.storage"): ReturnType<typeof extensionFixture> {
    return extensionFixture(id, "reportsStorage.cjs");
}

describe("ExtensionHost — каталоги хранения расширения", () => {
    /** Свой корень user-data для тестов, которым нужны собственные `storageHomes`. */
    const roots: string[] = [];
    const makeRoot = (): string => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "diode-extstorage-host-"));
        roots.push(root);
        return root;
    };

    afterEach(() => {
        for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
    });

    it("globalStorageUri / storageUri / logUri приезжают от хоста и указывают внутрь его корней", async () => {
        const harness = await createExtensionTestHarness({ extensions: [storageFixture()] });
        try {
            const report = (await harness.commandRegistry.execute("test.storage.report")) as IStorageReport;
            expect(report.globalStorageFsPath).toBe(path.join(harness.tmpDir, "globalStorage", "test.storage"));
            expect(report.storageFsPath).toBe(path.join(harness.tmpDir, "workspaceStorage", "test.storage"));
            expect(report.logFsPath).toBe(path.join(harness.tmpDir, "logs", "test.storage"));
            // Это именно Uri файловой схемы, а не «что-то со свойством fsPath».
            expect(report.globalStorageScheme).toBe("file");
            // Депрекейтнутые строковые близнецы — ровно fsPath своего Uri.
            expect(report.globalStoragePath).toBe(report.globalStorageFsPath);
            expect(report.storagePath).toBe(report.storageFsPath);
            expect(report.logPath).toBe(report.logFsPath);
        } finally {
            await harness.dispose();
        }
    });

    // Главный смысл задачи: расширение класса «свой движок + ghost text» кладёт
    // в globalStorage скачанный бинарь. Проверяем не наличие поля, а что по нему
    // реально можно писать — то есть что родителя создал хост.
    it("расширение создаёт свой каталог и пишет в него: родитель существует до activate()", async () => {
        const harness = await createExtensionTestHarness({ extensions: [storageFixture()] });
        try {
            const engine = path.join(harness.tmpDir, "globalStorage", "test.storage", "sm-agent");
            expect(fs.readFileSync(engine, "utf-8")).toBe("скачанный движок");
        } finally {
            await harness.dispose();
        }
    });

    // Контракт vscode.d.ts: «the directory might not exist … the parent directory
    // is guaranteed to be existent». Каталоги, которые расширение само не создало,
    // не создаёт и хост — он отвечает ровно за родителя.
    it("хост создаёт только РОДИТЕЛЯ, каталог расширения оставляет расширению", async () => {
        const harness = await createExtensionTestHarness({ extensions: [storageFixture()] });
        try {
            const report = (await harness.commandRegistry.execute("test.storage.report")) as IStorageReport;
            expect(report.logParentExists).toBe(true);
            expect(report.logDirExists).toBe(false);
        } finally {
            await harness.dispose();
        }
    });

    it("без открытой папки storageUri/storagePath — undefined (семантика vscode)", async () => {
        const root = makeRoot();
        const harness = await createExtensionTestHarness({
            extensions: [storageFixture()],
            storageHomes: (): IExtensionStorageHomes => ({
                globalStorageHome: path.join(root, "globalStorage"),
                workspaceStorageHome: null,
                logsHome: path.join(root, "logs"),
            }),
        });
        try {
            const report = (await harness.commandRegistry.execute("test.storage.report")) as IStorageReport;
            expect(report.storageFsPath).toBeNull();
            expect(report.storagePath).toBeNull();
            // globalStorage при этом на месте — оно от папки не зависит.
            expect(report.globalStorageFsPath).toBe(path.join(root, "globalStorage", "test.storage"));
        } finally {
            await harness.dispose();
        }
    });

    it("globalStorage адресуется по lowercase id — как в эталоне", async () => {
        const harness = await createExtensionTestHarness({ extensions: [storageFixture("Publisher.MixedCase")] });
        try {
            const report = (await harness.commandRegistry.execute("test.storage.report")) as IStorageReport;
            expect(report.globalStorageFsPath).toBe(path.join(harness.tmpDir, "globalStorage", "publisher.mixedcase"));
            // Воркспейсный и лог-каталоги — по id как есть.
            expect(report.storageFsPath).toBe(path.join(harness.tmpDir, "workspaceStorage", "Publisher.MixedCase"));
            expect(report.logFsPath).toBe(path.join(harness.tmpDir, "logs", "Publisher.MixedCase"));
        } finally {
            await harness.dispose();
        }
    });

    // Корни читаются на КАЖДОЙ активации: расширение может активироваться и до,
    // и после открытия папки, а `storageUri` зависит именно от неё.
    it("папка, открытая после первой активации, доезжает до следующего расширения", async () => {
        const root = makeRoot();
        let workspaceStorageHome: string | null = null;
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            storageHomes: (): IExtensionStorageHomes => ({
                globalStorageHome: path.join(root, "globalStorage"),
                workspaceStorageHome,
                logsHome: path.join(root, "logs"),
            }),
        });
        try {
            harness.host.registerExtension({ ...storageFixture("test.early"), activationEvents: ["early"] });
            harness.host.registerExtension({ ...storageFixture("test.late"), activationEvents: ["late"] });

            await harness.host.activateByEvent("early");
            const early = (await harness.commandRegistry.execute("test.storage.report")) as IStorageReport;
            expect(early.storageFsPath).toBeNull();

            workspaceStorageHome = path.join(root, "workspaceStorage", "hash");
            await harness.host.activateByEvent("late");
            // Вторая активация перерегистрирует команду на себя — читаем её же.
            const late = (await harness.commandRegistry.execute("test.storage.report")) as IStorageReport;
            expect(late.storageFsPath).toBe(path.join(root, "workspaceStorage", "hash", "test.late"));
        } finally {
            await harness.dispose();
        }
    });
});
