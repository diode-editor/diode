import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import type { ILogger } from "../../log/common/iLogger.ts";

import {
    createProfileExtensions,
    deleteUnusedExtensions,
    migrateProfileExtensions,
    PROFILE_EXTENSIONS_FILE,
    ProfileExtensions,
    profileExtensionsFiles,
    readProfileExtensions,
    writeProfileExtensions,
} from "./profileExtensions.ts";

function fakeLogger(): ILogger {
    return { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), isEnabled: () => true };
}

describe("profileExtensions", () => {
    let ws: ITempWorkspace;
    let extensionsDir: string;
    let defaultFile: string;
    let workFile: string;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-profile-extensions-" });
        extensionsDir = ws.path("extensions");
        defaultFile = path.join(extensionsDir, PROFILE_EXTENSIONS_FILE);
        workFile = ws.path("profiles/work/extensions.json");
    });

    afterEach(() => {
        ws.dispose();
    });

    /** Расширение в общем каталоге: `<id>-<version>/package.json`. */
    function onDisk(id: string, version = "1.0.0", dependencies?: string[]): void {
        const [publisher, name] = id.split(".");
        ws.writeFile(
            `extensions/${id}-${version}/package.json`,
            JSON.stringify({
                publisher,
                name,
                version,
                ...(dependencies !== undefined ? { extensionDependencies: dependencies } : {}),
            }),
        );
    }

    function ids(file: string): string[] | undefined {
        return readProfileExtensions(file)?.map((e) => e.identifier.id);
    }

    function profile(file: string, others: string[] = [], logger?: ILogger): ProfileExtensions {
        return new ProfileExtensions({
            extensionsDir,
            profileFile: file,
            allProfileFiles: () => [file, ...others],
            ...(logger !== undefined ? { logger } : {}),
        });
    }

    describe("readProfileExtensions / writeProfileExtensions", () => {
        it("нет файла — undefined", () => {
            expect(readProfileExtensions(defaultFile)).toBeUndefined();
        });

        it("запись создаёт каталог и пишет JSON без временного файла рядом", () => {
            writeProfileExtensions(workFile, [{ identifier: { id: "a.b" }, version: "1.0.0" }]);

            expect(JSON.parse(fs.readFileSync(workFile, "utf8"))).toEqual([
                { identifier: { id: "a.b" }, version: "1.0.0" },
            ]);
            expect(fs.readdirSync(path.dirname(workFile))).toEqual([PROFILE_EXTENSIONS_FILE]);
            expect(readProfileExtensions(workFile)).toEqual([{ identifier: { id: "a.b" }, version: "1.0.0" }]);
        });

        it("записи без identifier.id пропускаются, чужие поля записи сохраняются", () => {
            ws.writeFile(
                "profiles/work/extensions.json",
                JSON.stringify([
                    null,
                    "a.b",
                    {},
                    { identifier: null },
                    { identifier: {} },
                    { identifier: { id: "" } },
                    { identifier: { id: 7 } },
                    { identifier: { id: "a.b" }, version: "1.0.0", metadata: { pinned: true } },
                ]),
            );

            expect(readProfileExtensions(workFile)).toEqual([
                { identifier: { id: "a.b" }, version: "1.0.0", metadata: { pinned: true } },
            ]);
        });

        it.each([
            ["битый JSON", "[{"],
            ["не массив", `{"identifier":{"id":"a.b"}}`],
        ])("%s — ошибка с путём файла", (_what, text) => {
            ws.writeFile("profiles/work/extensions.json", text);

            expect(() => readProfileExtensions(workFile)).toThrow(`Invalid extensions profile content in ${workFile}`);
        });

        it("ошибка чтения не ENOENT (каталог вместо файла) — бросается как есть", () => {
            fs.mkdirSync(workFile, { recursive: true });

            expect(() => readProfileExtensions(workFile)).toThrow(/EISDIR/);
        });
    });

    describe("migrateProfileExtensions", () => {
        it("профилю без файла — все установленные, с каталогом установки; файл с составом не трогается", () => {
            onDisk("acme.tools", "1.2.0");
            onDisk("acme.base");
            writeProfileExtensions(workFile, []);

            const migrated = migrateProfileExtensions(extensionsDir, [defaultFile, workFile]);

            expect(migrated).toEqual([defaultFile]);
            expect(readProfileExtensions(defaultFile)).toEqual([
                { identifier: { id: "acme.base" }, version: "1.0.0", relativeLocation: "acme.base-1.0.0" },
                { identifier: { id: "acme.tools" }, version: "1.2.0", relativeLocation: "acme.tools-1.2.0" },
            ]);
            expect(ids(workFile)).toEqual([]);
        });

        it("все файлы на месте — ничего не пишет и каталог расширений не создаёт", () => {
            writeProfileExtensions(workFile, []);

            expect(migrateProfileExtensions(extensionsDir, [workFile])).toEqual([]);
            expect(fs.existsSync(extensionsDir)).toBe(false);
        });

        it("без установленных расширений состав пустой, но файл пишется", () => {
            expect(migrateProfileExtensions(extensionsDir, [defaultFile])).toEqual([defaultFile]);
            expect(ids(defaultFile)).toEqual([]);
        });
    });

    describe("profileExtensionsFiles", () => {
        it("известные реестру плюс каталоги профилей на диске, без дублей; файлы в profilesHome — не профили", () => {
            const profilesHome = ws.path("profiles");
            fs.mkdirSync(path.join(profilesHome, "work"), { recursive: true });
            fs.mkdirSync(path.join(profilesHome, "other"), { recursive: true });
            ws.writeFile("profiles/stray.txt", "");

            const files = profileExtensionsFiles([defaultFile, workFile], profilesHome);

            expect(files.sort()).toEqual(
                [defaultFile, workFile, path.join(profilesHome, "other", PROFILE_EXTENSIONS_FILE)].sort(),
            );
        });

        it("нет каталога профилей — только известные", () => {
            expect(profileExtensionsFiles([defaultFile], ws.path("missing"))).toEqual([defaultFile]);
        });
    });

    describe("deleteUnusedExtensions", () => {
        it("сносит то, чего нет ни в одном профиле (id без учёта регистра)", () => {
            onDisk("acme.tools");
            onDisk("acme.base");
            onDisk("acme.orphan");
            writeProfileExtensions(defaultFile, [{ identifier: { id: "ACME.Tools" }, version: "1.0.0" }]);
            writeProfileExtensions(workFile, [{ identifier: { id: "acme.base" }, version: "1.0.0" }]);

            expect(deleteUnusedExtensions(extensionsDir, [defaultFile, workFile])).toEqual(["acme.orphan"]);
            expect(fs.existsSync(ws.path("extensions/acme.orphan-1.0.0"))).toBe(false);
            expect(fs.existsSync(ws.path("extensions/acme.tools-1.0.0"))).toBe(true);
            expect(fs.existsSync(ws.path("extensions/acme.base-1.0.0"))).toBe(true);
        });

        it("с кандидатами — только среди них", () => {
            onDisk("acme.one");
            onDisk("acme.two");
            writeProfileExtensions(defaultFile, []);

            expect(deleteUnusedExtensions(extensionsDir, [defaultFile], ["ACME.TWO"])).toEqual(["acme.two"]);
            expect(fs.existsSync(ws.path("extensions/acme.one-1.0.0"))).toBe(true);
        });

        it("профиль без файла держит ничего", () => {
            onDisk("acme.one");

            expect(deleteUnusedExtensions(extensionsDir, [workFile])).toEqual(["acme.one"]);
        });

        it("нечитаемый файл профиля — не удаляется ничего", () => {
            onDisk("acme.one");
            writeProfileExtensions(defaultFile, []);
            ws.writeFile("profiles/work/extensions.json", "{");

            expect(deleteUnusedExtensions(extensionsDir, [defaultFile, workFile])).toEqual([]);
            expect(fs.existsSync(ws.path("extensions/acme.one-1.0.0"))).toBe(true);
        });
    });

    describe("ProfileExtensions", () => {
        it("list — установленные расширения профиля; запись без каталога на диске не видна", () => {
            onDisk("acme.tools");
            onDisk("acme.other");
            writeProfileExtensions(workFile, [
                { identifier: { id: "Acme.Tools" }, version: "0.1.0" },
                { identifier: { id: "acme.gone" }, version: "1.0.0" },
            ]);

            expect(
                profile(workFile)
                    .list()
                    .map((e) => `${e.id}@${e.version}`),
            ).toEqual(["acme.tools@1.0.0"]);
            expect(profile(workFile).extensionsDir).toBe(extensionsDir);
        });

        it("list: нет файла — пусто; нечитаемый — пусто и ошибка в лог", () => {
            onDisk("acme.tools");
            expect(profile(workFile).list()).toEqual([]);

            ws.writeFile("profiles/work/extensions.json", "{");
            const logger = fakeLogger();
            expect(profile(workFile, [], logger).list()).toEqual([]);
            expect(logger.error).toHaveBeenCalledWith(
                `Failed to read profile extensions ${workFile}`,
                expect.objectContaining({ message: `Invalid extensions profile content in ${workFile}` }),
            );
        });

        it("add — вместе с зависимостями с диска, транзитивно, без дублей; пропавшая зависимость не мешает", () => {
            onDisk("acme.tools", "1.0.0", ["ACME.base", "acme.missing"]);
            onDisk("acme.base", "2.0.0", ["acme.core", "acme.tools"]);
            onDisk("acme.core");
            onDisk("acme.unrelated");

            profile(workFile).add(["acme.tools", "acme.nothing"]);

            expect(readProfileExtensions(workFile)).toEqual([
                { identifier: { id: "acme.tools" }, version: "1.0.0", relativeLocation: "acme.tools-1.0.0" },
                { identifier: { id: "acme.base" }, version: "2.0.0", relativeLocation: "acme.base-2.0.0" },
                { identifier: { id: "acme.core" }, version: "1.0.0", relativeLocation: "acme.core-1.0.0" },
            ]);
        });

        it("add обновляет запись уже включённого (без дубля), прочие записи и их поля не трогает", () => {
            onDisk("acme.tools", "2.0.0");
            ws.writeFile(
                "profiles/work/extensions.json",
                JSON.stringify([
                    { identifier: { id: "Acme.Tools" }, version: "1.0.0" },
                    { identifier: { id: "x.y" }, version: "3.0.0", metadata: { pinned: true } },
                ]),
            );

            profile(workFile).add(["acme.tools"]);

            expect(readProfileExtensions(workFile)).toEqual([
                { identifier: { id: "x.y" }, version: "3.0.0", metadata: { pinned: true } },
                { identifier: { id: "acme.tools" }, version: "2.0.0", relativeLocation: "acme.tools-2.0.0" },
            ]);
        });

        it("add в нечитаемый файл — ошибка, файл не перезаписан", () => {
            onDisk("acme.tools");
            ws.writeFile("profiles/work/extensions.json", "{");

            expect(() => {
                profile(workFile).add(["acme.tools"]);
            }).toThrow("Invalid extensions profile content");
            expect(fs.readFileSync(workFile, "utf8")).toBe("{");
        });

        it("remove: не было в профиле — ничего не меняет", () => {
            onDisk("acme.tools");
            writeProfileExtensions(workFile, [{ identifier: { id: "x.y" }, version: "1.0.0" }]);
            const before = fs.statSync(workFile).mtimeMs;

            expect(profile(workFile).remove("acme.tools")).toEqual({ removed: false, deleted: [] });
            expect(fs.statSync(workFile).mtimeMs).toBe(before);
            expect(fs.existsSync(ws.path("extensions/acme.tools-1.0.0"))).toBe(true);
            // Нет файла — тоже «не было».
            expect(profile(defaultFile).remove("acme.tools")).toEqual({ removed: false, deleted: [] });
            expect(fs.existsSync(defaultFile)).toBe(false);
        });

        it("remove: больше никому не нужно — уходит и с диска", () => {
            onDisk("acme.tools");
            onDisk("acme.orphan");
            writeProfileExtensions(workFile, [
                { identifier: { id: "acme.tools" }, version: "1.0.0" },
                { identifier: { id: "x.y" }, version: "1.0.0" },
            ]);
            writeProfileExtensions(defaultFile, []);

            const logger = fakeLogger();
            expect(profile(workFile, [defaultFile], logger).remove("ACME.TOOLS")).toEqual({
                removed: true,
                deleted: ["acme.tools"],
            });
            // «Остаётся на диске» в лог не пишется — расширение удалено.
            expect(logger.info).not.toHaveBeenCalled();
            expect(ids(workFile)).toEqual(["x.y"]);
            expect(fs.existsSync(ws.path("extensions/acme.tools-1.0.0"))).toBe(false);
            // Чужой осиротевший каталог удаление одного расширения не трогает.
            expect(fs.existsSync(ws.path("extensions/acme.orphan-1.0.0"))).toBe(true);
        });

        it("remove: нужно другому профилю — остаётся на диске, причина в лог", () => {
            onDisk("acme.tools");
            writeProfileExtensions(workFile, [{ identifier: { id: "acme.tools" }, version: "1.0.0" }]);
            writeProfileExtensions(defaultFile, [{ identifier: { id: "acme.tools" }, version: "1.0.0" }]);
            const logger = fakeLogger();

            expect(profile(workFile, [defaultFile], logger).remove("acme.tools")).toEqual({
                removed: true,
                deleted: [],
            });
            expect(ids(workFile)).toEqual([]);
            expect(fs.existsSync(ws.path("extensions/acme.tools-1.0.0"))).toBe(true);
            expect(logger.info).toHaveBeenCalledWith("Extension acme.tools is kept on disk: another profile uses it");
        });
    });

    describe("createProfileExtensions", () => {
        it("файлы всех профилей — из реестра и с диска: расширение профиля, неизвестного реестру, не сносится", () => {
            onDisk("acme.tools");
            writeProfileExtensions(defaultFile, [{ identifier: { id: "acme.tools" }, version: "1.0.0" }]);
            // Профиль, созданный другим окном: в реестре этого процесса его нет.
            const foreign = ws.path("profiles/foreign/extensions.json");
            writeProfileExtensions(foreign, [{ identifier: { id: "acme.tools" }, version: "1.0.0" }]);

            const logger = fakeLogger();
            const extensions = createProfileExtensions({
                extensionsDir,
                profile: { extensionsResource: defaultFile },
                profiles: { profilesHome: ws.path("profiles"), profiles: [{ extensionsResource: defaultFile }] },
                logger,
            });

            expect(extensions.remove("acme.tools")).toEqual({ removed: true, deleted: [] });
            expect(fs.existsSync(ws.path("extensions/acme.tools-1.0.0"))).toBe(true);
            expect(logger.info).toHaveBeenCalled();

            // Последний держатель — и каталог уходит.
            const last = createProfileExtensions({
                extensionsDir,
                profile: { extensionsResource: foreign },
                profiles: { profilesHome: ws.path("profiles"), profiles: [{ extensionsResource: defaultFile }] },
            });
            expect(last.remove("acme.tools")).toEqual({ removed: true, deleted: ["acme.tools"] });
        });
    });
});
