import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFileExtensionSecretStore, createInMemoryExtensionSecretStore } from "./extensionSecretsStore.ts";

const roots: string[] = [];

function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "diode-secretstore-"));
    roots.push(root);
    return root;
}

afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("createInMemoryExtensionSecretStore", () => {
    it("хранит, отдаёт и удаляет по паре «расширение + ключ»", () => {
        const store = createInMemoryExtensionSecretStore();
        expect(store.get("pub.one", "token")).toBeUndefined();
        store.store("pub.one", "token", "s3cr3t");
        expect(store.get("pub.one", "token")).toBe("s3cr3t");
        // Тот же ключ у другого расширения — другой секрет.
        expect(store.get("pub.two", "token")).toBeUndefined();
        store.store("pub.two", "token", "чужой");
        expect(store.get("pub.one", "token")).toBe("s3cr3t");
        store.delete("pub.one", "token");
        expect(store.get("pub.one", "token")).toBeUndefined();
        expect(store.get("pub.two", "token")).toBe("чужой");
    });

    it("keys перечисляет ключи расширения и пустеет вместе с ним", () => {
        const store = createInMemoryExtensionSecretStore();
        expect(store.keys("pub.one")).toEqual([]);
        store.store("pub.one", "token", "a");
        store.store("pub.one", "refresh", "b");
        expect(store.keys("pub.one")).toEqual(["token", "refresh"]);
        store.delete("pub.one", "token");
        expect(store.keys("pub.one")).toEqual(["refresh"]);
    });

    it("delete несуществующего — тихий no-op", () => {
        const store = createInMemoryExtensionSecretStore();
        expect(() => {
            store.delete("pub.one", "token");
        }).not.toThrow();
        store.store("pub.one", "token", "a");
        store.delete("pub.one", "нет такого");
        expect(store.get("pub.one", "token")).toBe("a");
    });
});

describe("createFileExtensionSecretStore", () => {
    it("записанное переживает пересоздание хранилища — оно лежит в файле", () => {
        const file = path.join(makeRoot(), "User", "secrets.json");
        createFileExtensionSecretStore(file).store("pub.one", "token", "s3cr3t");
        // Новый экземпляр — как новый запуск редактора.
        expect(createFileExtensionSecretStore(file).get("pub.one", "token")).toBe("s3cr3t");
    });

    it("удаление тоже доезжает до файла", () => {
        const file = path.join(makeRoot(), "secrets.json");
        const first = createFileExtensionSecretStore(file);
        first.store("pub.one", "token", "s3cr3t");
        first.store("pub.one", "refresh", "r");
        first.delete("pub.one", "token");
        const second = createFileExtensionSecretStore(file);
        expect(second.get("pub.one", "token")).toBeUndefined();
        expect(second.keys("pub.one")).toEqual(["refresh"]);
    });

    it("опустевшее расширение не оставляет за собой пустой лоток", () => {
        const file = path.join(makeRoot(), "secrets.json");
        const store = createFileExtensionSecretStore(file);
        store.store("pub.one", "token", "s3cr3t");
        store.delete("pub.one", "token");
        expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toEqual({});
    });

    it("файл создаётся с правами 0600 и остаётся таким, даже если приехал чужим", () => {
        const root = makeRoot();
        const file = path.join(root, "secrets.json");
        // Файл из чужой копии user-data — с мировыми правами.
        fs.writeFileSync(file, "{}", { encoding: "utf-8", mode: 0o644 });
        createFileExtensionSecretStore(file).store("pub.one", "token", "s3cr3t");
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    });

    it("нет файла — пустое хранилище, и это НЕ ошибка: onError молчит", () => {
        // Чистая установка — штатное состояние, а не беда хранилища; жалоба в
        // лог тут была бы ложной тревогой на каждом первом запуске.
        const seen: string[] = [];
        const store = createFileExtensionSecretStore(path.join(makeRoot(), "нет", "secrets.json"), (message) =>
            seen.push(message),
        );
        expect(store.get("pub.one", "token")).toBeUndefined();
        expect(store.keys("pub.one")).toEqual([]);
        expect(seen).toEqual([]);
    });

    it("битый файл без onError — тоже пустое хранилище, а не падение", () => {
        // `onError` необязателен (харнессы его не передают) — отсутствие
        // слушателя не должно превращать беду хранилища в исключение.
        const file = path.join(makeRoot(), "secrets.json");
        fs.writeFileSync(file, "{не json", "utf-8");
        const store = createFileExtensionSecretStore(file);
        expect(() => store.get("pub.one", "token")).not.toThrow();
        expect(store.keys("pub.one")).toEqual([]);
    });

    it("незаписываемый путь без onError — тоже не падение", () => {
        const file = path.join(makeRoot(), "secrets.json");
        fs.mkdirSync(file);
        const store = createFileExtensionSecretStore(file);
        expect(() => {
            store.store("pub.one", "token", "s3cr3t");
        }).not.toThrow();
    });

    it("файл `null` на верхнем уровне — пустое хранилище, а не падение", () => {
        const file = path.join(makeRoot(), "secrets.json");
        fs.writeFileSync(file, "null", "utf-8");
        const store = createFileExtensionSecretStore(file);
        expect(() => store.keys("pub.one")).not.toThrow();
        expect(store.keys("pub.one")).toEqual([]);
    });

    it("битый JSON — пустое хранилище и сообщение об ошибке без значений", () => {
        const file = path.join(makeRoot(), "secrets.json");
        fs.writeFileSync(file, "{не json", "utf-8");
        const seen: string[] = [];
        const store = createFileExtensionSecretStore(file, (message) => seen.push(message));
        expect(store.get("pub.one", "token")).toBeUndefined();
        expect(seen).toHaveLength(1);
        expect(seen[0]).toContain("failed to parse");
    });

    it("чужая форма файла (массив, не-объектные лотки, нестроковые значения) отбрасывается поштучно", () => {
        const file = path.join(makeRoot(), "secrets.json");
        fs.writeFileSync(
            file,
            JSON.stringify({
                "pub.one": { token: "s3cr3t", broken: 42, alsoBroken: null },
                "pub.array": ["не лоток"],
                "pub.null": null,
                "pub.empty": { onlyBroken: 1 },
            }),
            "utf-8",
        );
        const store = createFileExtensionSecretStore(file);
        expect(store.keys("pub.one")).toEqual(["token"]);
        expect(store.get("pub.one", "token")).toBe("s3cr3t");
        expect(store.keys("pub.array")).toEqual([]);
        expect(store.keys("pub.null")).toEqual([]);
        expect(store.keys("pub.empty")).toEqual([]);
    });

    it("файл-массив на верхнем уровне — тоже пустое хранилище", () => {
        const file = path.join(makeRoot(), "secrets.json");
        fs.writeFileSync(file, "[]", "utf-8");
        expect(createFileExtensionSecretStore(file).keys("pub.one")).toEqual([]);
    });

    it("НЕпустой массив на верхнем уровне не становится лотками с индексами", () => {
        // Массив — это `typeof === "object"`, и без явной проверки его элементы
        // разъехались бы по «расширениям» с именами "0", "1", …
        const file = path.join(makeRoot(), "secrets.json");
        fs.writeFileSync(file, JSON.stringify([{ token: "s3cr3t" }, { other: "x" }]), "utf-8");
        const store = createFileExtensionSecretStore(file);
        expect(store.keys("0")).toEqual([]);
        expect(store.get("0", "token")).toBeUndefined();
    });

    it("опустевший лоток не воскресает в файле при следующей записи", () => {
        // Иначе файл копил бы пустые `{}` расширений, которые когда-то что-то
        // хранили, — и «чей это секрет» перестало бы читаться глазами.
        const file = path.join(makeRoot(), "secrets.json");
        fs.writeFileSync(file, JSON.stringify({ "pub.gone": { onlyBroken: 1 } }), "utf-8");
        const store = createFileExtensionSecretStore(file);
        store.store("pub.other", "token", "s3cr3t");
        expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toEqual({ "pub.other": { token: "s3cr3t" } });
    });

    it("незаписываемый путь не роняет хост — беда уходит в onError", () => {
        // Каталог на месте файла: writeFileSync по нему всегда падает.
        const file = path.join(makeRoot(), "secrets.json");
        fs.mkdirSync(file);
        const seen: string[] = [];
        const store = createFileExtensionSecretStore(file, (message) => seen.push(message));
        expect(() => {
            store.store("pub.one", "token", "s3cr3t");
        }).not.toThrow();
        expect(seen.some((m) => m.includes("failed to write"))).toBe(true);
        // В памяти запись всё равно состоялась — расширение в этом сеансе живёт.
        expect(store.get("pub.one", "token")).toBe("s3cr3t");
    });

    it("delete отсутствующего лотка не пишет файл вовсе", () => {
        const file = path.join(makeRoot(), "secrets.json");
        const store = createFileExtensionSecretStore(file);
        store.delete("pub.one", "token");
        expect(fs.existsSync(file)).toBe(false);
    });
});
