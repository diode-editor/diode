import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import yazl from "yazl";

import { FsAssetAccess } from "../../../base/node/assets/fsAssetAccess.ts";
import { scanExtensions } from "../../extensions/common/extensionScanner.ts";

import { installVsix, listInstalledExtensions, uninstallExtension } from "./extensionInstaller.ts";

/** Каноничный набор записей внутри `.vsix` для расширения с заданным манифестом. */
function vsixEntries(manifest: object, extra: Record<string, string> = {}): Record<string, string> {
    return {
        "extension/package.json": JSON.stringify(manifest),
        // Служебные файлы vsix — installer должен их игнорировать.
        "extension.vsixmanifest": "<PackageManifest/>",
        "[Content_Types].xml": "<Types/>",
        ...extra,
    };
}

/** Собирает `.vsix` (zip) из карты «путь-в-архиве → содержимое» и пишет в `vsixPath`. */
function buildVsix(vsixPath: string, entries: Record<string, string>): Promise<void> {
    return new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile();
        for (const [name, content] of Object.entries(entries)) {
            zip.addBuffer(Buffer.from(content), name);
        }
        const out = fs.createWriteStream(vsixPath);
        out.on("close", () => {
            resolve();
        });
        out.on("error", reject);
        zip.outputStream.on("error", reject);
        zip.outputStream.pipe(out);
        zip.end();
    });
}

describe("ExtensionInstaller", () => {
    let tempRoot: string;
    let extensionsDir: string;
    let vsixDir: string;

    beforeEach(async () => {
        tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "diode-ext-install-"));
        extensionsDir = path.join(tempRoot, "extensions");
        vsixDir = path.join(tempRoot, "vsix");
        await fs.promises.mkdir(vsixDir, { recursive: true });
    });

    afterEach(async () => {
        await fs.promises.rm(tempRoot, { recursive: true, force: true });
    });

    async function makeVsix(name: string, entries: Record<string, string>): Promise<string> {
        const vsixPath = path.join(vsixDir, name);
        await buildVsix(vsixPath, entries);
        return vsixPath;
    }

    it("устанавливает расширение в <id>-<version> и распаковывает вложенные файлы", async () => {
        const vsix = await makeVsix(
            "acme.hello.vsix",
            vsixEntries(
                { name: "hello", publisher: "acme", version: "1.0.0" },
                { "extension/node_modules/dep/index.js": "module.exports = 42;" },
            ),
        );

        const result = await installVsix(vsix, extensionsDir);

        expect(result).toEqual({ id: "acme.hello", version: "1.0.0", previous: [] });
        const dir = path.join(extensionsDir, "acme.hello-1.0.0");
        expect(fs.existsSync(path.join(dir, "package.json"))).toBe(true);
        // Вложенные node_modules сохранены (гарантия для расширений с зависимостями).
        expect(fs.readFileSync(path.join(dir, "node_modules/dep/index.js"), "utf8")).toBe("module.exports = 42;");
        // Служебные vsix-файлы не распакованы.
        expect(fs.existsSync(path.join(dir, "extension.vsixmanifest"))).toBe(false);
        expect(fs.existsSync(path.join(dir, "[Content_Types].xml"))).toBe(false);
    });

    it("установленное расширение видит scanExtensions", async () => {
        const vsix = await makeVsix(
            "acme.hello.vsix",
            vsixEntries({ name: "hello", publisher: "acme", version: "2.3.4" }),
        );
        await installVsix(vsix, extensionsDir);

        const assets = new FsAssetAccess({ "UserExtensions/": extensionsDir });
        const scanned = await scanExtensions(assets, "UserExtensions/", { isBuiltin: false });

        expect(scanned).toHaveLength(1);
        expect(scanned[0].id).toBe("acme.hello");
        expect(scanned[0].manifest.version).toBe("2.3.4");
    });

    it("переустановка новой версии удаляет старый каталог", async () => {
        await installVsix(
            await makeVsix("v1.vsix", vsixEntries({ name: "hello", publisher: "acme", version: "1.0.0" })),
            extensionsDir,
        );
        const result = await installVsix(
            await makeVsix("v2.vsix", vsixEntries({ name: "hello", publisher: "acme", version: "2.0.0" })),
            extensionsDir,
        );

        expect(result.previous).toEqual(["1.0.0"]);
        expect(fs.existsSync(path.join(extensionsDir, "acme.hello-1.0.0"))).toBe(false);
        expect(fs.existsSync(path.join(extensionsDir, "acme.hello-2.0.0"))).toBe(true);
        expect(listInstalledExtensions(extensionsDir)).toHaveLength(1);
    });

    it("переустановка той же версии перезаписывает каталог без дубликатов", async () => {
        const manifest = { name: "hello", publisher: "acme", version: "1.0.0" };
        await installVsix(
            await makeVsix("a.vsix", vsixEntries(manifest, { "extension/a.txt": "first" })),
            extensionsDir,
        );
        await installVsix(
            await makeVsix("b.vsix", vsixEntries(manifest, { "extension/b.txt": "second" })),
            extensionsDir,
        );

        const dir = path.join(extensionsDir, "acme.hello-1.0.0");
        expect(fs.existsSync(path.join(dir, "a.txt"))).toBe(false);
        expect(fs.readFileSync(path.join(dir, "b.txt"), "utf8")).toBe("second");
        expect(listInstalledExtensions(extensionsDir)).toHaveLength(1);
    });

    it("uninstall сносит все версии, повторный вызов — no-op", async () => {
        await installVsix(
            await makeVsix("v1.vsix", vsixEntries({ name: "hello", publisher: "acme", version: "1.0.0" })),
            extensionsDir,
        );
        // Вторая версия рядом (симулируем ручную установку).
        fs.mkdirSync(path.join(extensionsDir, "acme.hello-9.9.9"), { recursive: true });
        fs.writeFileSync(
            path.join(extensionsDir, "acme.hello-9.9.9", "package.json"),
            JSON.stringify({ name: "hello", publisher: "acme", version: "9.9.9" }),
        );
        // Постороннее расширение — не должно быть затронуто.
        await installVsix(
            await makeVsix("other.vsix", vsixEntries({ name: "thing", publisher: "acme", version: "1.0.0" })),
            extensionsDir,
        );

        const first = uninstallExtension("acme.hello", extensionsDir);
        expect(first.removed).toHaveLength(2);
        expect(listInstalledExtensions(extensionsDir).map((e) => e.id)).toEqual(["acme.thing"]);

        const second = uninstallExtension("acme.hello", extensionsDir);
        expect(second.removed).toEqual([]);
    });

    it("list возвращает id/version отсортированно, битые каталоги игнорирует", async () => {
        await installVsix(
            await makeVsix("z.vsix", vsixEntries({ name: "zeta", publisher: "acme", version: "1.0.0" })),
            extensionsDir,
        );
        await installVsix(
            await makeVsix("a.vsix", vsixEntries({ name: "alpha", publisher: "acme", version: "5.0.0" })),
            extensionsDir,
        );
        // Мусорный каталог без package.json.
        fs.mkdirSync(path.join(extensionsDir, "garbage"), { recursive: true });
        // Каталог с package.json, но без обязательного поля version.
        fs.mkdirSync(path.join(extensionsDir, "no-version"), { recursive: true });
        fs.writeFileSync(
            path.join(extensionsDir, "no-version", "package.json"),
            JSON.stringify({ name: "x", publisher: "y" }),
        );
        // Обычный файл верхнего уровня (не каталог) — пропускается.
        fs.writeFileSync(path.join(extensionsDir, "stray.txt"), "noise");

        const list = listInstalledExtensions(extensionsDir);
        expect(list.map((e) => `${e.id}@${e.version}`)).toEqual(["acme.alpha@5.0.0", "acme.zeta@1.0.0"]);
    });

    it("list/uninstall на отсутствующем каталоге extensions → пусто", () => {
        const missing = path.join(tempRoot, "does-not-exist");
        expect(listInstalledExtensions(missing)).toEqual([]);
        expect(uninstallExtension("acme.hello", missing)).toEqual({ removed: [] });
    });

    it("битый zip → понятная ошибка, temp подчищен", async () => {
        const bad = path.join(vsixDir, "broken.vsix");
        fs.writeFileSync(bad, "this is not a zip file");

        await expect(installVsix(bad, extensionsDir)).rejects.toThrow(/valid \.vsix/);

        const leftovers = fs.readdirSync(extensionsDir).filter((n) => n.startsWith(".vsix-install-"));
        expect(leftovers).toEqual([]);
    });

    it("манифест без publisher → ошибка, ничего не установлено, temp подчищен", async () => {
        const vsix = await makeVsix("nopub.vsix", vsixEntries({ name: "hello", version: "1.0.0" }));

        await expect(installVsix(vsix, extensionsDir)).rejects.toThrow(/"publisher"/);

        expect(fs.readdirSync(extensionsDir)).toEqual([]);
    });

    it("vsix без extension/package.json → понятная ошибка, temp подчищен", async () => {
        // Валидный zip, но полезной нагрузки extension/ нет.
        const vsix = await makeVsix("empty.vsix", { "extension.vsixmanifest": "<PackageManifest/>" });

        await expect(installVsix(vsix, extensionsDir)).rejects.toThrow(/package\.json/);

        expect(fs.readdirSync(extensionsDir)).toEqual([]);
    });

    it("отклоняет zip-slip запись за пределами целевого каталога", async () => {
        // yazl (как и yauzl) запрещает `..` в имени, поэтому собираем архив с
        // плейсхолдер-именем той же длины и патчим байты на `..`-путь.
        const placeholder = "extension/aa/evil.txt";
        const malicious = "extension/../evil.txt"; // та же длина (21)
        const vsix = await makeVsix("evil.vsix", {
            "extension/package.json": JSON.stringify({ name: "hello", publisher: "acme", version: "1.0.0" }),
            [placeholder]: "pwned",
        });
        const buf = fs.readFileSync(vsix);
        const from = Buffer.from(placeholder);
        const to = Buffer.from(malicious);
        for (let i = buf.indexOf(from); i !== -1; i = buf.indexOf(from, i + to.length)) {
            to.copy(buf, i);
        }
        fs.writeFileSync(vsix, buf);

        // Отвергается (нашим guard'ом либо валидацией yauzl); файл наружу не создан.
        await expect(installVsix(vsix, extensionsDir)).rejects.toThrow(/zip-slip|invalid relative path/i);
        expect(fs.existsSync(path.join(tempRoot, "evil.txt"))).toBe(false);
    });
});
