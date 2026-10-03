import * as path from "node:path";

import { describe, expect, it } from "vitest";

import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { IExtensionManifest } from "../../../../platform/extensions/common/iExtensionManifest.ts";

import type { IExtensionRegistrationEnv } from "./extensionRegistration.ts";
import { collectCommandMeta, toExtensionRegistration } from "./extensionRegistration.ts";

const USER_DIR = path.resolve("/home/u/.diode/extensions");

function manifest(overrides: Partial<IExtensionManifest> = {}): IExtensionManifest {
    return { name: "sample", publisher: "acme", version: "1.2.3", engines: { vscode: "*" }, ...overrides };
}

function extension(overrides: Partial<IExtension> & { manifest: IExtensionManifest }): IExtension {
    return { id: "acme.sample", location: "UserExtensions/acme.sample-1.2.3/", isBuiltin: false, ...overrides };
}

/** Окружение с записью чтений исходника и инъекцией, видимой по id. */
function env(overrides: Partial<IExtensionRegistrationEnv> = {}): IExtensionRegistrationEnv & { reads: string[] } {
    const reads: string[] = [];
    return {
        reads,
        userPrefix: "UserExtensions/",
        userExtensionsDir: USER_DIR,
        readBuiltinSource: (virtualPath) => {
            reads.push(virtualPath);
            return Promise.resolve(`// source of ${virtualPath}`);
        },
        configInjection: () => ({}),
        ...overrides,
    };
}

describe("toExtensionRegistration", () => {
    it("без main регистрировать нечего — null, исходник не читается", async () => {
        const e = env();

        expect(await toExtensionRegistration(extension({ manifest: manifest() }), e)).toBeNull();
        expect(
            await toExtensionRegistration(extension({ manifest: manifest({ main: "" }), isBuiltin: true }), e),
        ).toBeNull();
        expect(e.reads).toEqual([]);
    });

    it("пользовательское грузится с диска: каталог установки и main от него", async () => {
        const reg = await toExtensionRegistration(extension({ manifest: manifest({ main: "./out/ext.js" }) }), env());

        const extensionPath = path.join(USER_DIR, "acme.sample-1.2.3");
        expect(reg).toMatchObject({
            id: "acme.sample",
            extensionPath,
            mainPath: path.join(extensionPath, "out/ext.js"),
        });
        expect(reg).not.toHaveProperty("source");
        expect(reg).not.toHaveProperty("filename");
    });

    it("встроенное грузится исходником из ассетов по виртуальному пути", async () => {
        const e = env();
        const reg = await toExtensionRegistration(
            extension({
                id: "vscode.git",
                location: "extensions/git",
                isBuiltin: true,
                manifest: manifest({ main: "./out/extension.cjs" }),
            }),
            e,
        );

        expect(e.reads).toEqual(["extensions/git/out/extension.cjs"]);
        expect(reg).toMatchObject({
            source: "// source of extensions/git/out/extension.cjs",
            filename: "/extensions/git/out/extension.cjs",
        });
        expect(reg).not.toHaveProperty("mainPath");
        expect(reg).not.toHaveProperty("extensionPath");
    });

    it("манифест едет целиком (packageJSON в vscode.extensions), события активации — как в манифесте", async () => {
        const m = manifest({ main: "ext.js", categories: ["AI"], activationEvents: ["onLanguage:python"] });

        const reg = await toExtensionRegistration(extension({ manifest: m }), env());

        expect(reg?.manifest).toBe(m);
        expect(reg?.activationEvents).toEqual(["onLanguage:python"]);
    });

    it("события активации — полный набор: объявленные плюс неявные от contributes, без неявного *", async () => {
        const m = manifest({
            main: "ext.js",
            activationEvents: ["onStartupFinished"],
            contributes: { commands: [{ command: "sample.run", title: "Run" }], languages: [{ id: "sample" }] },
        });

        const withContributes = await toExtensionRegistration(extension({ manifest: m }), env());
        const bare = await toExtensionRegistration(extension({ manifest: manifest({ main: "ext.js" }) }), env());

        expect(withContributes?.activationEvents).toEqual([
            "onStartupFinished",
            "onCommand:sample.run",
            "onLanguage:sample",
        ]);
        expect(bare?.activationEvents).toEqual([]);
    });

    it("дефолты настроек: манифестные, поверх — инъекция host'а для этого расширения", async () => {
        const m = manifest({
            main: "ext.js",
            contributes: {
                configuration: {
                    properties: {
                        "sample.mode": { type: "string", default: "fromEnvironment" },
                        "sample.level": { type: "number", default: 3 },
                    },
                },
            },
        });
        const seen: string[] = [];
        const e = env({
            configInjection: (ext) => {
                seen.push(ext.id);
                return { "sample.mode": "bundled", "sample.extra": true };
            },
        });

        const reg = await toExtensionRegistration(extension({ manifest: m }), e);

        expect(seen).toEqual(["acme.sample"]);
        expect(reg?.configDefaults).toEqual({ "sample.mode": "bundled", "sample.level": 3, "sample.extra": true });
    });

    it("заголовки и категории команд — для палитры", async () => {
        const m = manifest({
            main: "ext.js",
            contributes: {
                commands: [
                    { command: "sample.run", title: "Run", category: "Sample" },
                    { command: "sample.stop", title: "Stop" },
                ],
            },
        });

        const reg = await toExtensionRegistration(extension({ manifest: m }), env());

        expect(reg?.commandTitles).toEqual({ "sample.run": "Run", "sample.stop": "Stop" });
        expect(reg?.commandCategories).toEqual({ "sample.run": "Sample" });
    });
});

describe("collectCommandMeta", () => {
    it("без команд — ни заголовков, ни категорий", () => {
        expect(collectCommandMeta(undefined)).toStrictEqual({});
        const empty = collectCommandMeta([]);
        expect(empty.titles).toBeUndefined();
        expect(empty.categories).toBeUndefined();
    });

    it("пропускает записи без строкового id или заголовка и пустые категории", () => {
        const meta = collectCommandMeta([
            { command: "a", title: "A", category: "" },
            { command: "b" } as never,
            { title: "C" } as never,
            { command: "d", title: "D", category: 7 } as never,
        ]);

        // Строго: пропущенная запись не должна оставить ключ с undefined.
        expect(meta.titles).toStrictEqual({ a: "A", d: "D" });
        expect(meta.categories).toBeUndefined();
    });
});
