import { afterEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import type { IExtensionRegistrySource } from "../../../../platform/extensionManagement/common/iExtensionRegistrySource.ts";
import {
    REGISTRY_SCHEMA_VERSION,
    type IRegistryExtensionMeta,
    type IRegistryIndex,
    type IRegistryIndexEntry,
} from "../../../../platform/extensionManagement/common/registryFormat.ts";
import type { IHostVersions } from "../../../../platform/extensionManagement/common/resolveCompatibleVersion.ts";

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

    public fetchArtifact(): Promise<string> {
        throw new Error("not used");
    }
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
});
