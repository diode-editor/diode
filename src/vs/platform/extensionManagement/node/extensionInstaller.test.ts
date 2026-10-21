import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import yazl from "yazl";

import { FsAssetAccess } from "../../../base/node/assets/fsAssetAccess.ts";
import { scanExtensions } from "../../extensions/common/extensionScanner.ts";

import { installVsix, listInstalledExtensions, readVsixManifest, uninstallExtension } from "./extensionInstaller.ts";

function vsixEntries(manifest: object, extra: Record<string, string> = {}): Record<string, string> {
    return {
        "extension/package.json": JSON.stringify(manifest),
        "extension.vsixmanifest": "<PackageManifest/>",
        "[Content_Types].xml": "<Types/>",
        ...extra,
    };
}

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
        expect(fs.readFileSync(path.join(dir, "node_modules/dep/index.js"), "utf8")).toBe("module.exports = 42;");
        expect(fs.existsSync(path.join(dir, "extension.vsixmanifest"))).toBe(false);
        expect(fs.existsSync(path.join(dir, "[Content_Types].xml"))).toBe(false);
    });

    it.skipIf(process.platform === "win32")("восстанавливает exec-бит нативного бинаря из zip-атрибутов", async () => {
        const vsixPath = path.join(vsixDir, "acme.native.vsix");
        await new Promise<void>((resolve, reject) => {
            const zip = new yazl.ZipFile();
            zip.addBuffer(
                Buffer.from(JSON.stringify({ name: "native", publisher: "acme", version: "1.0.0", engines: {} })),
                "extension/package.json",
            );
            zip.addBuffer(Buffer.from("#!/bin/sh\necho ok\n"), "extension/bundled/bin/server", { mode: 0o100755 });
            zip.addBuffer(Buffer.from("just data"), "extension/bundled/data.txt", { mode: 0o100644 });
            const out = fs.createWriteStream(vsixPath);
            out.on("close", () => {
                resolve();
            });
            out.on("error", reject);
            zip.outputStream.on("error", reject);
            zip.outputStream.pipe(out);
            zip.end();
        });

        await installVsix(vsixPath, extensionsDir);

        const dir = path.join(extensionsDir, "acme.native-1.0.0");
        const serverMode = fs.statSync(path.join(dir, "bundled/bin/server")).mode;
        const dataMode = fs.statSync(path.join(dir, "bundled/data.txt")).mode;
        expect(serverMode & 0o111).not.toBe(0);
        expect(dataMode & 0o111).toBe(0);
    });

    // yazl always writes unix (3) into the version-made-by host byte, so we patch it
    // to 0 (MS-DOS) directly in the central directory of the built zip.
    it.skipIf(process.platform === "win32")("не доверяет exec-битам архива от не-unix упаковщика", async () => {
        const vsixPath = path.join(vsixDir, "acme.dos.vsix");
        await new Promise<void>((resolve, reject) => {
            const zip = new yazl.ZipFile();
            zip.addBuffer(
                Buffer.from(JSON.stringify({ name: "dos", publisher: "acme", version: "1.0.0", engines: {} })),
                "extension/package.json",
            );
            zip.addBuffer(Buffer.from("binary-ish"), "extension/bundled/bin/tool", { mode: 0o100755 });
            const out = fs.createWriteStream(vsixPath);
            out.on("close", () => {
                resolve();
            });
            out.on("error", reject);
            zip.outputStream.on("error", reject);
            zip.outputStream.pipe(out);
            zip.end();
        });
        const bytes = fs.readFileSync(vsixPath);
        // Central directory records: signature PK\x01\x02; host OS is the high byte of
        // version-made-by at offset +5 from the signature.
        for (let i = 0; i + 5 < bytes.length; i++) {
            if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x01 && bytes[i + 3] === 0x02) {
                bytes[i + 5] = 0;
            }
        }
        fs.writeFileSync(vsixPath, bytes);

        await installVsix(vsixPath, extensionsDir);

        const toolMode = fs.statSync(path.join(extensionsDir, "acme.dos-1.0.0", "bundled/bin/tool")).mode;
        expect(toolMode & 0o111).toBe(0);
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
        fs.mkdirSync(path.join(extensionsDir, "acme.hello-9.9.9"), { recursive: true });
        fs.writeFileSync(
            path.join(extensionsDir, "acme.hello-9.9.9", "package.json"),
            JSON.stringify({ name: "hello", publisher: "acme", version: "9.9.9" }),
        );
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

    it("list отдаёт displayName и description манифеста — их показывает магазин", async () => {
        await installVsix(
            await makeVsix(
                "named.vsix",
                vsixEntries({
                    name: "hello",
                    publisher: "acme",
                    version: "1.0.0",
                    displayName: "Hello Extension",
                    description: "Says hello",
                }),
            ),
            extensionsDir,
        );

        expect(listInstalledExtensions(extensionsDir)[0]).toMatchObject({
            id: "acme.hello",
            displayName: "Hello Extension",
            description: "Says hello",
        });
    });

    it("list резолвит %ключи% displayName/description по package.nls.json", async () => {
        await installVsix(
            await makeVsix(
                "nls.vsix",
                vsixEntries(
                    {
                        name: "java",
                        publisher: "redhat",
                        version: "1.0.0",
                        displayName: "%displayName%",
                        description: "%description%",
                    },
                    {
                        "extension/package.nls.json": JSON.stringify({
                            displayName: "Language Support for Java(TM)",
                            description: "Java linting and more",
                        }),
                    },
                ),
            ),
            extensionsDir,
        );

        expect(listInstalledExtensions(extensionsDir)[0]).toMatchObject({
            id: "redhat.java",
            displayName: "Language Support for Java(TM)",
            description: "Java linting and more",
        });
    });

    it("нет nls-файла или ключа — строка остаётся ключом, расширение из списка не выпадает", async () => {
        await installVsix(
            await makeVsix(
                "nonls.vsix",
                vsixEntries({
                    name: "java",
                    publisher: "redhat",
                    version: "1.0.0",
                    displayName: "%displayName%",
                    description: "%description%",
                }),
            ),
            extensionsDir,
        );
        await installVsix(
            await makeVsix(
                "partial.vsix",
                vsixEntries(
                    {
                        name: "kotlin",
                        publisher: "acme",
                        version: "1.0.0",
                        displayName: "%displayName%",
                        description: "%description%",
                    },
                    { "extension/package.nls.json": JSON.stringify({ displayName: "Kotlin" }) },
                ),
            ),
            extensionsDir,
        );

        const byId = new Map(listInstalledExtensions(extensionsDir).map((e) => [e.id, e]));
        expect(byId.get("redhat.java")?.displayName).toBe("%displayName%");
        expect(byId.get("redhat.java")?.description).toBe("%description%");
        expect(byId.get("acme.kotlin")?.displayName).toBe("Kotlin");
        expect(byId.get("acme.kotlin")?.description).toBe("%description%");
    });

    it("битый package.nls.json не ломает list", async () => {
        await installVsix(
            await makeVsix(
                "broken-nls.vsix",
                vsixEntries(
                    { name: "java", publisher: "redhat", version: "1.0.0", displayName: "%displayName%" },
                    { "extension/package.nls.json": "{not json" },
                ),
            ),
            extensionsDir,
        );

        expect(listInstalledExtensions(extensionsDir)[0]).toMatchObject({
            id: "redhat.java",
            displayName: "%displayName%",
        });
    });

    it("манифест без описательных полей (или с мусором в них) отдаёт undefined, а не мусор", async () => {
        await installVsix(
            await makeVsix("bare.vsix", vsixEntries({ name: "bare", publisher: "acme", version: "1.0.0" })),
            extensionsDir,
        );
        fs.mkdirSync(path.join(extensionsDir, "acme.junk-1.0.0"), { recursive: true });
        fs.writeFileSync(
            path.join(extensionsDir, "acme.junk-1.0.0", "package.json"),
            JSON.stringify({ name: "junk", publisher: "acme", version: "1.0.0", displayName: "", description: 42 }),
        );

        const byId = new Map(listInstalledExtensions(extensionsDir).map((e) => [e.id, e]));
        expect(byId.get("acme.bare")?.displayName).toBeUndefined();
        expect(byId.get("acme.bare")?.description).toBeUndefined();
        expect(byId.get("acme.junk")?.displayName).toBeUndefined();
        expect(byId.get("acme.junk")?.description).toBeUndefined();
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
        fs.mkdirSync(path.join(extensionsDir, "garbage"), { recursive: true });
        fs.mkdirSync(path.join(extensionsDir, "no-version"), { recursive: true });
        fs.writeFileSync(
            path.join(extensionsDir, "no-version", "package.json"),
            JSON.stringify({ name: "x", publisher: "y" }),
        );
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
        const vsix = await makeVsix("empty.vsix", { "extension.vsixmanifest": "<PackageManifest/>" });

        await expect(installVsix(vsix, extensionsDir)).rejects.toThrow(/package\.json/);

        expect(fs.readdirSync(extensionsDir)).toEqual([]);
    });

    it("отклоняет zip-slip запись за пределами целевого каталога", async () => {
        // yazl (like yauzl) forbids `..` in names, so we build the archive with a
        // same-length placeholder name and patch the bytes to a `..` path.
        const placeholder = "extension/aa/evil.txt";
        const malicious = "extension/../evil.txt"; // same length (21)
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

        await expect(installVsix(vsix, extensionsDir)).rejects.toThrow(/zip-slip|invalid relative path/i);
        expect(fs.existsSync(path.join(tempRoot, "evil.txt"))).toBe(false);
    });

    describe("readVsixManifest", () => {
        it("отдаёт манифест из extension/package.json и ничего не ставит", async () => {
            const manifest = { name: "hello", publisher: "acme", version: "1.0.0", extensionDependencies: ["a.b"] };
            const vsix = await makeVsix("acme.hello.vsix", {
                "extension/readme.md": "# до манифеста",
                ...vsixEntries(manifest, { "extension/zzz.txt": "после манифеста" }),
            });

            expect(await readVsixManifest(vsix)).toEqual(manifest);
            expect(fs.existsSync(extensionsDir)).toBe(false);
        });

        it("нет manifest'а, не JSON или не объект — та же ошибка, что у установки", async () => {
            const cases: Record<string, Record<string, string>> = {
                "missing.vsix": { "extension/readme.md": "# no manifest" },
                "broken.vsix": { "extension/package.json": "{ not json" },
                "array.vsix": { "extension/package.json": "[1, 2]" },
                "null.vsix": { "extension/package.json": "null" },
            };
            for (const [name, entries] of Object.entries(cases)) {
                const vsix = await makeVsix(name, entries);
                expect(await rejectionOf(readVsixManifest(vsix))).toEqual(
                    new Error(`Invalid .vsix: missing or malformed extension/package.json in ${vsix}`),
                );
            }
        });

        it("битая запись архива (имя с `..`) — отказ ошибкой yauzl, а не зависание", async () => {
            const placeholder = "extension/aa/evil.txt";
            const vsix = await makeVsix("evil.vsix", {
                [placeholder]: "pwned",
                "extension/package.json": JSON.stringify({ name: "hello", publisher: "acme", version: "1.0.0" }),
            });
            const buf = fs.readFileSync(vsix);
            const from = Buffer.from(placeholder);
            const to = Buffer.from("extension/../evil.txt");
            for (let i = buf.indexOf(from); i !== -1; i = buf.indexOf(from, i + to.length)) to.copy(buf, i);
            fs.writeFileSync(vsix, buf);

            const error = await rejectionOf(readVsixManifest(vsix));
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toMatch(/invalid relative path/iu);
        });

        it("не zip — понятная ошибка", async () => {
            const vsix = path.join(vsixDir, "not-a-zip.vsix");
            await fs.promises.writeFile(vsix, "plain text");

            expect(await rejectionOf(readVsixManifest(vsix))).toEqual(
                new Error(`Not a valid .vsix (zip) archive: ${vsix}`),
            );
        });
    });

    /** `rejects.toThrow(text)` also passes on a rejection with `undefined` (caught by a mutant). */
    async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
        try {
            await promise;
        } catch (error) {
            return error;
        }
        throw new Error("expected the promise to reject");
    }
});
