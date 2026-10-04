import { describe, expect, it } from "vitest";

import { createExtensionsNamespace } from "./extensionsNamespace.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import type { IWireExtensionDescription } from "./wireTypes.ts";

function description(id: string, overrides: Partial<IWireExtensionDescription> = {}): IWireExtensionDescription {
    return {
        id,
        extensionPath: `/ext/${id}`,
        packageJSON: { name: id },
        isActive: false,
        ...overrides,
    };
}

describe("extensionsNamespace", () => {
    it("до первого каталога состав пуст, а getExtension честно молчит", () => {
        const { extensions } = createExtensionsNamespace(makeStubRpc().rpc);
        expect(extensions.all).toEqual([]);
        expect(extensions.getExtension("a.b")).toBeUndefined();
    });

    it("каталог от хоста наполняет all и getExtension", () => {
        const stub = makeStubRpc();
        const { extensions } = createExtensionsNamespace(stub.rpc);
        stub.fire("extensions.catalog", {
            extensions: [description("pub.one", { isActive: true }), description("pub.two")],
        });
        expect(extensions.all.map((e) => e.id)).toEqual(["pub.one", "pub.two"]);
        const one = extensions.getExtension("pub.one");
        expect(one?.extensionPath).toBe("/ext/pub.one");
        expect(one?.extensionUri.fsPath).toBe("/ext/pub.one");
        expect(one?.packageJSON).toEqual({ name: "pub.one" });
        expect(one?.isActive).toBe(true);
        expect(extensions.getExtension("pub.two")?.isActive).toBe(false);
    });

    it("onDidReceiveCatalog — каждый принятый каталог целиком, даже без смены состава", () => {
        const stub = makeStubRpc();
        const { onDidReceiveCatalog } = createExtensionsNamespace(stub.rpc);
        const received: string[][] = [];
        onDidReceiveCatalog((catalog) => received.push(catalog.map((d) => d.extensionPath)));
        stub.fire("extensions.catalog", { extensions: [description("pub.one")] });
        stub.fire("extensions.catalog", { extensions: [description("pub.one")] });
        stub.fire("extensions.catalog", { что: "не то" });
        expect(received).toEqual([["/ext/pub.one"], ["/ext/pub.one"]]);
    });

    it("чужая форма каталога не трогает уже известный состав", () => {
        const stub = makeStubRpc();
        const { extensions } = createExtensionsNamespace(stub.rpc);
        stub.fire("extensions.catalog", { extensions: [description("pub.one")] });
        stub.fire("extensions.catalog", { что: "не то" });
        expect(extensions.all.map((e) => e.id)).toEqual(["pub.one"]);
    });

    it("`extensions.activated` поднимает isActive у уже выданного объекта", () => {
        const stub = makeStubRpc();
        const { extensions } = createExtensionsNamespace(stub.rpc);
        stub.fire("extensions.catalog", { extensions: [description("pub.one")] });
        // Расширение вправе подержать ссылку и спросить позже — это живой вид,
        // а не снимок на момент getExtension.
        const held = extensions.getExtension("pub.one");
        expect(held?.isActive).toBe(false);
        stub.fire("extensions.activated", { id: "pub.one" });
        expect(held?.isActive).toBe(true);
    });

    it("мусорный `extensions.activated` игнорируется", () => {
        const stub = makeStubRpc();
        const { extensions } = createExtensionsNamespace(stub.rpc);
        stub.fire("extensions.catalog", { extensions: [description("pub.one")] });
        stub.fire("extensions.activated", { id: 42 });
        expect(extensions.getExtension("pub.one")?.isActive).toBe(false);
    });

    it("каталог, приехавший ПОСЛЕ activated, не гасит поднятый флаг", () => {
        // Порядок сообщений от хоста не гарантирован; терять активность из-за
        // более старого снимка каталога нельзя.
        const stub = makeStubRpc();
        const { extensions } = createExtensionsNamespace(stub.rpc);
        stub.fire("extensions.catalog", { extensions: [description("pub.one")] });
        stub.fire("extensions.activated", { id: "pub.one" });
        stub.fire("extensions.catalog", { extensions: [description("pub.one"), description("pub.two")] });
        expect(extensions.getExtension("pub.one")?.isActive).toBe(true);
    });

    it("исчезнувшее из каталога расширение перестаёт числиться активным", () => {
        const stub = makeStubRpc();
        const { extensions } = createExtensionsNamespace(stub.rpc);
        stub.fire("extensions.catalog", { extensions: [description("pub.one", { isActive: true })] });
        stub.fire("extensions.catalog", { extensions: [description("pub.two")] });
        expect(extensions.getExtension("pub.one")).toBeUndefined();
        // Вернулся под тем же id — но уже как неактивный, флаг не всплыл.
        stub.fire("extensions.catalog", { extensions: [description("pub.one")] });
        expect(extensions.getExtension("pub.one")?.isActive).toBe(false);
    });

    it("onDidChange — про состав: стреляет на появление и исчезновение, молчит на активацию", () => {
        const stub = makeStubRpc();
        const { extensions } = createExtensionsNamespace(stub.rpc);
        let fired = 0;
        extensions.onDidChange(() => {
            fired += 1;
        });
        stub.fire("extensions.catalog", { extensions: [description("pub.one")] });
        expect(fired).toBe(1);
        // Тот же состав — события нет.
        stub.fire("extensions.catalog", { extensions: [description("pub.one", { isActive: true })] });
        expect(fired).toBe(1);
        stub.fire("extensions.activated", { id: "pub.one" });
        expect(fired).toBe(1);
        stub.fire("extensions.catalog", { extensions: [description("pub.one"), description("pub.two")] });
        expect(fired).toBe(2);
        stub.fire("extensions.catalog", { extensions: [description("pub.two")] });
        expect(fired).toBe(3);
    });

    it("перестановка тех же расширений — тоже смена состава", () => {
        const stub = makeStubRpc();
        const { extensions } = createExtensionsNamespace(stub.rpc);
        let fired = 0;
        extensions.onDidChange(() => {
            fired += 1;
        });
        stub.fire("extensions.catalog", { extensions: [description("pub.one"), description("pub.two")] });
        expect(fired).toBe(1);
        stub.fire("extensions.catalog", { extensions: [description("pub.two"), description("pub.one")] });
        expect(fired).toBe(2);
    });

    it("замена ОДНОГО расширения из двух — тоже смена состава", () => {
        // Длина та же, первый id совпадает, отличается только второй: сравнение
        // «хоть один разошёлся», а не «все разошлись».
        const stub = makeStubRpc();
        const { extensions } = createExtensionsNamespace(stub.rpc);
        let fired = 0;
        extensions.onDidChange(() => {
            fired += 1;
        });
        stub.fire("extensions.catalog", { extensions: [description("pub.one"), description("pub.two")] });
        expect(fired).toBe(1);
        stub.fire("extensions.catalog", { extensions: [description("pub.one"), description("pub.three")] });
        expect(fired).toBe(2);
    });

    it("exports читаются из общей карты субпроцесса, а не из провода", () => {
        const stub = makeStubRpc();
        const { extensions, exportsById } = createExtensionsNamespace(stub.rpc);
        stub.fire("extensions.catalog", { extensions: [description("pub.one")] });
        expect(extensions.getExtension("pub.one")?.exports).toBeUndefined();
        exportsById.set("pub.one", { api: 1 });
        expect(extensions.getExtension("pub.one")?.exports).toEqual({ api: 1 });
    });

    it("activate() активного отдаёт exports, неактивного — отказывает с объяснением", async () => {
        const stub = makeStubRpc();
        const { extensions, exportsById } = createExtensionsNamespace(stub.rpc);
        stub.fire("extensions.catalog", { extensions: [description("pub.one"), description("pub.two")] });
        exportsById.set("pub.one", { api: 1 });
        stub.fire("extensions.activated", { id: "pub.one" });

        const active = extensions.getExtension("pub.one")!;
        await expect(active.activate()).resolves.toEqual({ api: 1 });

        // Сообщение отказа проверяем целиком: расширение читает его в логе, и
        // «not implemented» без объяснения «активацией распоряжается хост»
        // отправляет автора чинить свой код вместо нашего.
        const sleeping = extensions.getExtension("pub.two")!;
        await expect(sleeping.activate()).rejects.toThrow(
            "extension.activate() is not implemented in Diode: activation is driven by the host. " +
                "Extensions that are already active return their exports.",
        );
    });

    it("идентичность записи стабильна в пределах состава и обновляется с новым каталогом", () => {
        // Сравнение по ссылке в расширениях встречается (на `activeTextEditor`
        // мы уже обжигались), а `all` зовут в циклах — новый объект на каждый
        // геттер был бы и ложью, и мусором.
        const stub = makeStubRpc();
        const { extensions } = createExtensionsNamespace(stub.rpc);
        stub.fire("extensions.catalog", { extensions: [description("pub.one")] });
        const first = extensions.getExtension("pub.one");
        expect(extensions.getExtension("pub.one")).toBe(first);
        expect(extensions.all[0]).toBe(first);
        expect(extensions.all).toBe(extensions.all);

        stub.fire("extensions.catalog", { extensions: [description("pub.one"), description("pub.two")] });
        expect(extensions.getExtension("pub.one")).not.toBe(first);
    });

    it("extensionKind у всех — UI: удалённого extension host'а в Diode нет", () => {
        const stub = makeStubRpc();
        const { extensions } = createExtensionsNamespace(stub.rpc);
        stub.fire("extensions.catalog", { extensions: [description("pub.one")] });
        expect(extensions.all.map((e) => e.extensionKind)).toEqual([1]);
    });
});
