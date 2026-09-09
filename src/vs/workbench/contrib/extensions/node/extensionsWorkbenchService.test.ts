import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import yazl from "yazl";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import type { IExtensionRegistrySource } from "../../../../platform/extensionManagement/common/iExtensionRegistrySource.ts";
import {
    REGISTRY_SCHEMA_VERSION,
    type IRegistryExtensionMeta,
    type IRegistryIndex,
    type IRegistryIndexEntry,
} from "../../../../platform/extensionManagement/common/registryFormat.ts";
import type { IHostVersions } from "../../../../platform/extensionManagement/common/resolveCompatibleVersion.ts";

import { sha256File } from "../../../../platform/extensionManagement/node/installFromRegistry.ts";

import { ExtensionsWorkbenchService } from "./extensionsWorkbenchService.ts";

const HOST: IHostVersions = { diode: "1.0.0", vscode: "1.90.0" };

function entry(overrides: Partial<IRegistryIndexEntry> & { id: string }): IRegistryIndexEntry {
    const [publisher, name] = overrides.id.split(".");
    return {
        publisher: publisher!,
        name: name!,
        displayName: name!,
        description: "",
        kind: "native",
        latest: { version: "1.0.0", engines: { vscode: "^1.90.0" } },
        ...overrides,
    };
}

function index(...extensions: IRegistryIndexEntry[]): IRegistryIndex {
    return { schemaVersion: REGISTRY_SCHEMA_VERSION, extensions };
}

/** Источник-фейк: полностью под контролем теста, без сети и файлов реестра. */
class FakeSource implements IExtensionRegistrySource {
    public indexCalls = 0;
    public metaCalls = 0;

    public constructor(
        public result: IRegistryIndex | Error,
        private readonly metas: Record<string, IRegistryExtensionMeta> = {},
    ) {}

    public getIndex(): Promise<IRegistryIndex> {
        this.indexCalls++;
        return this.result instanceof Error ? Promise.reject(this.result) : Promise.resolve(this.result);
    }

    public getMeta(id: string): Promise<IRegistryExtensionMeta | undefined> {
        this.metaCalls++;
        return Promise.resolve(this.metas[id]);
    }

    /** Путь к настоящему `.vsix`, который отдаёт установке; `null` — артефактов нет. */
    public artifact: string | null = null;

    public fetchArtifact(): Promise<string> {
        if (this.artifact === null) throw new Error("not used");
        return Promise.resolve(this.artifact);
    }
}

/** Собирает настоящий `.vsix` — установка распаковывает его как обычно. */
function buildVsix(file: string, manifest: object): Promise<void> {
    return new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile();
        zip.addBuffer(Buffer.from(JSON.stringify(manifest)), "extension/package.json");
        const out = fs.createWriteStream(file);
        out.on("close", () => resolve());
        out.on("error", reject);
        zip.outputStream.on("error", reject);
        zip.outputStream.pipe(out);
        zip.end();
    });
}

/** Кладёт в `extensions/` каталог установленного расширения с манифестом. */
function installOnDisk(
    ws: ITempWorkspace,
    id: string,
    version: string,
    manifest: Record<string, unknown> = {},
): void {
    const [publisher, name] = id.split(".");
    ws.writeFile(
        `extensions/${id}-${version}/package.json`,
        JSON.stringify({ publisher, name, version, ...manifest }),
    );
}

describe("ExtensionsWorkbenchService", () => {
    let ws: ITempWorkspace | undefined;

    afterEach(() => {
        ws?.dispose();
        ws = undefined;
    });

    function createService(source: IExtensionRegistrySource): ExtensionsWorkbenchService {
        ws ??= createTempWorkspace({ prefix: "diode-extensions-view-" });
        return new ExtensionsWorkbenchService(source, ws.path("extensions"), HOST);
    }

    it("до первого показа каталог пуст, а установленное уже видно", () => {
        ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
        installOnDisk(ws, "acme.tools", "1.0.0");
        const service = createService(new FakeSource(index(entry({ id: "acme.tools" }))));

        expect(service.getEntries().map((e) => e.id)).toEqual(["acme.tools"]);
        expect(service.getEntries()[0]?.latestVersion).toBeNull();
    });

    it("ensureLoaded читает индекс один раз, refresh — каждый раз", async () => {
        const source = new FakeSource(index(entry({ id: "acme.tools" })));
        const service = createService(source);

        await service.ensureLoaded();
        await service.ensureLoaded();
        expect(source.indexCalls).toBe(1);

        await service.refresh();
        expect(source.indexCalls).toBe(2);
    });

    it("смена состава каталога доезжает до подписчиков", async () => {
        const source = new FakeSource(index(entry({ id: "acme.tools" })));
        const service = createService(source);
        let changes = 0;
        service.onDidChange(() => {
            changes++;
        });

        await service.ensureLoaded();
        expect(changes).toBe(1);
        expect(service.getEntries().map((e) => e.id)).toEqual(["acme.tools"]);

        source.result = index(entry({ id: "acme.tools" }), entry({ id: "acme.other" }));
        await service.refresh();
        expect(changes).toBe(2);
        expect(service.getEntries().map((e) => e.id)).toEqual(["acme.tools", "acme.other"]);
    });

    it("подписка снимается по dispose ссылки", async () => {
        const service = createService(new FakeSource(index(entry({ id: "acme.tools" }))));
        let changes = 0;
        const subscription = service.onDidChange(() => {
            changes++;
        });

        subscription.dispose();
        await service.ensureLoaded();
        expect(changes).toBe(0);
    });

    describe("состояние карточки", () => {
        it("не установлено и совместимо — available", async () => {
            const service = createService(new FakeSource(index(entry({ id: "acme.tools" }))));
            await service.ensureLoaded();
            expect(service.getEntries()[0]?.availability).toBe("available");
        });

        it("установлена последняя версия — installed", async () => {
            ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
            installOnDisk(ws, "acme.tools", "1.0.0");
            const service = createService(new FakeSource(index(entry({ id: "acme.tools" }))));

            await service.ensureLoaded();
            expect(service.getEntries()[0]).toMatchObject({
                availability: "installed",
                installedVersion: "1.0.0",
                latestVersion: "1.0.0",
            });
        });

        it("установлена версия старее реестровой — outdated", async () => {
            ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
            installOnDisk(ws, "acme.tools", "0.9.0");
            const service = createService(new FakeSource(index(entry({ id: "acme.tools" }))));

            await service.ensureLoaded();
            expect(service.getEntries()[0]).toMatchObject({
                availability: "outdated",
                installedVersion: "0.9.0",
                latestVersion: "1.0.0",
            });
        });

        it("engines последней версии не подходят сборке — incompatible", async () => {
            const source = new FakeSource(
                index(entry({ id: "acme.tools", latest: { version: "2.0.0", engines: { vscode: "^99.0.0" } } })),
            );
            const service = createService(source);

            await service.ensureLoaded();
            expect(service.getEntries()[0]?.availability).toBe("incompatible");
        });

        it("несовместимость важнее установленной версии", async () => {
            ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
            installOnDisk(ws, "acme.tools", "0.9.0");
            const source = new FakeSource(
                index(entry({ id: "acme.tools", latest: { version: "2.0.0", engines: { vscode: "^99.0.0" } } })),
            );
            const service = createService(source);

            await service.ensureLoaded();
            expect(service.getEntries()[0]?.availability).toBe("incompatible");
        });
    });

    it("установленное из магазина — одна карточка, а не две", async () => {
        ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
        installOnDisk(ws, "acme.tools", "1.0.0");
        const service = createService(new FakeSource(index(entry({ id: "acme.tools" }))));

        await service.ensureLoaded();
        // Запись есть и в индексе, и на диске — но карточка одна: иначе то же
        // расширение показалось бы ещё раз как «установленное мимо магазина».
        expect(service.getEntries().map((e) => e.id)).toEqual(["acme.tools"]);
    });

    it("установленное вне реестра идёт после каталога и берёт поля из манифеста", async () => {
        ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
        installOnDisk(ws, "local.sideloaded", "0.1.0", {
            displayName: "Sideloaded",
            description: "Installed by hand",
        });
        const service = createService(new FakeSource(index(entry({ id: "acme.tools" }))));

        await service.ensureLoaded();
        expect(service.getEntries().map((e) => e.id)).toEqual(["acme.tools", "local.sideloaded"]);
        expect(service.getEntries()[1]).toMatchObject({
            publisher: "local",
            name: "sideloaded",
            displayName: "Sideloaded",
            description: "Installed by hand",
            kind: undefined,
            latestVersion: null,
            installedVersion: "0.1.0",
            availability: "installed",
        });
    });

    it("манифест без displayName/description — карточка обходится id", async () => {
        ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
        installOnDisk(ws, "local.bare", "0.1.0");
        const service = createService(new FakeSource(index()));

        await service.ensureLoaded();
        expect(service.getEntries()[0]).toMatchObject({
            displayName: "local.bare",
            description: "",
        });
    });

    it("сетевая ошибка не бросается: каталог пуст, причина в getCatalogError", async () => {
        ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
        installOnDisk(ws, "local.sideloaded", "0.1.0");
        const service = createService(new FakeSource(new Error("getaddrinfo ENOTFOUND example.invalid")));

        await service.ensureLoaded();
        expect(service.getCatalogError()).toBe("getaddrinfo ENOTFOUND example.invalid");
        // Установленные видны и без сети — иначе оффлайн лишал бы пользователя
        // единственного списка, который вообще не требует реестра.
        expect(service.getEntries().map((e) => e.id)).toEqual(["local.sideloaded"]);
    });

    it("не-Error причина сбоя тоже доезжает текстом", async () => {
        const source = new FakeSource(index());
        const service = createService(source);
        source.getIndex = () => Promise.reject("boom");

        await service.ensureLoaded();
        expect(service.getCatalogError()).toBe("boom");
    });

    it("удачный refresh снимает прежнюю ошибку", async () => {
        const source = new FakeSource(new Error("offline"));
        const service = createService(source);
        await service.ensureLoaded();
        expect(service.getCatalogError()).toBe("offline");

        source.result = index(entry({ id: "acme.tools" }));
        await service.refresh();
        expect(service.getCatalogError()).toBeNull();
        expect(service.getEntries().map((e) => e.id)).toEqual(["acme.tools"]);
    });

    it("неудачный refresh сохраняет прошлый каталог", async () => {
        const source = new FakeSource(index(entry({ id: "acme.tools" })));
        const service = createService(source);
        await service.ensureLoaded();

        source.result = new Error("offline");
        await service.refresh();
        expect(service.getEntries().map((e) => e.id)).toEqual(["acme.tools"]);
        expect(service.getCatalogError()).toBe("offline");
    });

    it("reloadInstalled подхватывает появившееся на диске расширение", async () => {
        ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
        const service = createService(new FakeSource(index(entry({ id: "acme.tools" }))));
        await service.ensureLoaded();
        expect(service.getEntries()[0]?.availability).toBe("available");

        installOnDisk(ws, "acme.tools", "1.0.0");
        service.reloadInstalled();
        expect(service.getEntries()[0]?.availability).toBe("installed");
    });

    describe("getMeta", () => {
        const meta: IRegistryExtensionMeta = {
            schemaVersion: REGISTRY_SCHEMA_VERSION,
            id: "acme.tools",
            publisher: "acme",
            name: "tools",
            displayName: "Tools",
            description: "",
            kind: "native",
            versions: [],
        };

        it("кэширует ответ реестра", async () => {
            const source = new FakeSource(index(entry({ id: "acme.tools" })), { "acme.tools": meta });
            const service = createService(source);

            expect(await service.getMeta("acme.tools")).toBe(meta);
            expect(await service.getMeta("acme.tools")).toBe(meta);
            expect(source.metaCalls).toBe(1);
        });

        it("кэширует и промах — «такого id нет» тоже ответ", async () => {
            const source = new FakeSource(index());
            const service = createService(source);

            expect(await service.getMeta("acme.missing")).toBeUndefined();
            expect(await service.getMeta("acme.missing")).toBeUndefined();
            expect(source.metaCalls).toBe(1);
        });
    });

    it("dispose снимает подписки", async () => {
        const source = new FakeSource(index(entry({ id: "acme.tools" })));
        const service = createService(source);
        let changes = 0;
        service.onDidChange(() => {
            changes++;
        });

        service.dispose();
        await service.ensureLoaded();
        expect(changes).toBe(0);
    });

    describe("установка и удаление", () => {
        /**
         * Готовит источник, отдающий настоящий `.vsix` версии `version`, и сервис
         * поверх временного каталога расширений.
         */
        async function withInstallable(
            version = "1.0.0",
            options: { sha256?: string } = {},
        ): Promise<{ service: ExtensionsWorkbenchService; source: FakeSource }> {
            ws ??= createTempWorkspace({ prefix: "diode-extensions-view-" });
            const vsix = ws.path(`artifacts/acme.tools-${version}.vsix`);
            fs.mkdirSync(path.dirname(vsix), { recursive: true });
            await buildVsix(vsix, { publisher: "acme", name: "tools", version });
            const meta: IRegistryExtensionMeta = {
                schemaVersion: REGISTRY_SCHEMA_VERSION,
                id: "acme.tools",
                publisher: "acme",
                name: "tools",
                displayName: "Acme Tools",
                description: "",
                kind: "native",
                versions: [
                    {
                        version,
                        engines: { vscode: "^1.90.0" },
                        artifact: { type: "path", path: vsix },
                        sha256: options.sha256 ?? (await sha256File(vsix)),
                    },
                ],
            };
            const source = new FakeSource(index(entry({ id: "acme.tools", latest: { version, engines: { vscode: "^1.90.0" } } })), {
                "acme.tools": meta,
            });
            source.artifact = vsix;
            return { service: createService(source), source };
        }

        it("ставит расширение на диск и помечает карточку ожиданием перезагрузки", async () => {
            const { service } = await withInstallable();
            await service.ensureLoaded();

            const result = await service.install("acme.tools");

            expect(result).toEqual({ ok: true, version: "1.0.0" });
            expect(fs.existsSync(ws!.path("extensions/acme.tools-1.0.0/package.json"))).toBe(true);
            const card = service.getEntries()[0]!;
            expect(card.installedVersion).toBe("1.0.0");
            expect(card.availability).toBe("installed");
            // Вклады сканируются на старте — до перезагрузки окна расширение не работает.
            expect(card.needsReload).toBe(true);
        });

        it("установка перерисовывает список подписчикам", async () => {
            const { service } = await withInstallable();
            await service.ensureLoaded();
            let changes = 0;
            service.onDidChange(() => {
                changes++;
            });

            await service.install("acme.tools");

            expect(changes).toBe(1);
        });

        it("обновление сносит прежнюю версию — на диске остаётся одна", async () => {
            ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
            installOnDisk(ws, "acme.tools", "0.9.0");
            const { service } = await withInstallable("1.0.0");
            await service.ensureLoaded();
            expect(service.getEntries()[0]?.availability).toBe("outdated");

            await service.install("acme.tools");

            expect(fs.existsSync(ws.path("extensions/acme.tools-0.9.0"))).toBe(false);
            expect(service.getEntries()[0]?.installedVersion).toBe("1.0.0");
        });

        it("битый артефакт не ставится, а причина возвращается текстом", async () => {
            const { service } = await withInstallable("1.0.0", { sha256: "0".repeat(64) });
            await service.ensureLoaded();

            const result = await service.install("acme.tools");

            expect(result.ok).toBe(false);
            expect(result.ok === false && result.error).toContain("sha256 mismatch");
            // Ни следа на диске и никакого «ждём перезагрузки»: ничего не произошло.
            expect(fs.existsSync(ws!.path("extensions/acme.tools-1.0.0"))).toBe(false);
            expect(service.getEntries()[0]?.needsReload).toBe(false);
        });

        it("незнакомый реестру id — ошибка значением, а не исключением", async () => {
            const service = createService(new FakeSource(index()));

            await expect(service.install("acme.missing")).resolves.toEqual({
                ok: false,
                error: 'Extension "acme.missing" not found in registry',
            });
        });

        it("удаляет расширение с диска и просит перезагрузку", async () => {
            ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
            installOnDisk(ws, "acme.tools", "1.0.0");
            const service = createService(new FakeSource(index(entry({ id: "acme.tools" }))));
            await service.ensureLoaded();

            const result = await service.uninstall("acme.tools");

            expect(result).toEqual({ ok: true });
            expect(fs.existsSync(ws.path("extensions/acme.tools-1.0.0"))).toBe(false);
            const card = service.getEntries()[0]!;
            expect(card.installedVersion).toBeNull();
            expect(card.needsReload).toBe(true);
        });

        it("удалять нечего — это отказ, а не тихий успех", async () => {
            const service = createService(new FakeSource(index(entry({ id: "acme.tools" }))));
            await service.ensureLoaded();

            const result = await service.uninstall("acme.tools");

            expect(result).toEqual({ ok: false, error: "Extension acme.tools is not installed" });
            expect(service.getEntries()[0]?.needsReload).toBe(false);
        });

        it.skipIf(process.platform === "win32")("сбой файловой системы приезжает текстом, а не исключением", async () => {
            ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
            installOnDisk(ws, "acme.tools", "1.0.0");
            const service = createService(new FakeSource(index(entry({ id: "acme.tools" }))));
            await service.ensureLoaded();

            // Каталог расширений только на чтение — снести из него нечего.
            fs.chmodSync(ws.path("extensions"), 0o500);
            try {
                const result = await service.uninstall("acme.tools");
                expect(result.ok).toBe(false);
                expect(result.ok === false && result.error).toMatch(/EACCES|EPERM/);
            } finally {
                fs.chmodSync(ws.path("extensions"), 0o700);
            }
        });

        it("ожидание перезагрузки переживает Refresh каталога", async () => {
            const { service, source } = await withInstallable();
            await service.ensureLoaded();
            await service.install("acme.tools");

            source.result = index(entry({ id: "acme.tools" }), entry({ id: "acme.other" }));
            await service.refresh();

            expect(service.getEntries().find((e) => e.id === "acme.tools")?.needsReload).toBe(true);
            expect(service.getEntries().find((e) => e.id === "acme.other")?.needsReload).toBe(false);
        });

        it("расширение мимо магазина тоже ждёт перезагрузки после удаления", async () => {
            ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
            installOnDisk(ws, "solo.thing", "0.1.0");
            installOnDisk(ws, "other.thing", "0.1.0");
            const service = createService(new FakeSource(index()));

            await service.uninstall("solo.thing");

            // Удалённого в списке уже нет; соседняя запись не помечена.
            expect(service.getEntries().map((e) => e.id)).toEqual(["other.thing"]);
            expect(service.getEntries()[0]?.needsReload).toBe(false);
        });
    });
});
