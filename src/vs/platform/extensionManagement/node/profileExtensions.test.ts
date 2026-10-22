import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import type { ILogger } from "../../log/common/iLogger.ts";

import type { IInstalledExtension } from "./extensionInstaller.ts";
import { markObsolete, OBSOLETE_FILE, readObsolete } from "./obsoleteExtensions.ts";
import {
    compareLooseVersions,
    createProfileExtensions,
    type IStoredProfileExtension,
    markUnusedExtensions,
    migrateProfileExtensions,
    PROFILE_EXTENSIONS_FILE,
    ProfileExtensions,
    profileExtensionsFiles,
    readProfileExtensions,
    referencedExtensionDirs,
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

    /** Returns the extension directory. */
    function onDisk(id: string, version = "1.0.0", dependencies?: string[]): string {
        const [publisher, name] = id.split(".");
        const manifest = ws.writeFile(
            `extensions/${id}-${version}/package.json`,
            JSON.stringify({
                publisher,
                name,
                version,
                ...(dependencies !== undefined ? { extensionDependencies: dependencies } : {}),
            }),
        );
        return path.dirname(manifest);
    }

    /** An entry as `add` writes it. */
    function entry(id: string, version: string): IStoredProfileExtension {
        return { identifier: { id }, version, relativeLocation: `${id}-${version}` };
    }

    function names(extensions: readonly IInstalledExtension[]): string[] {
        return extensions.map((e) => `${e.id}@${e.version}`);
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
        it("no file returns undefined", () => {
            expect(readProfileExtensions(defaultFile)).toBeUndefined();
        });

        it("write creates the directory and writes JSON without a temp file next to it", () => {
            writeProfileExtensions(workFile, [{ identifier: { id: "a.b" }, version: "1.0.0" }]);

            expect(JSON.parse(fs.readFileSync(workFile, "utf8"))).toEqual([
                { identifier: { id: "a.b" }, version: "1.0.0" },
            ]);
            expect(fs.readdirSync(path.dirname(workFile))).toEqual([PROFILE_EXTENSIONS_FILE]);
            expect(readProfileExtensions(workFile)).toEqual([{ identifier: { id: "a.b" }, version: "1.0.0" }]);
        });

        it("entries without identifier.id are skipped, unknown entry fields are kept", () => {
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
            ["malformed JSON", "[{"],
            ["not an array", `{"identifier":{"id":"a.b"}}`],
        ])("%s fails with the file path", (_what, text) => {
            ws.writeFile("profiles/work/extensions.json", text);

            expect(() => readProfileExtensions(workFile)).toThrow(`Invalid extensions profile content in ${workFile}`);
        });

        it("a non-ENOENT read error (directory instead of file) is thrown as is", () => {
            fs.mkdirSync(workFile, { recursive: true });

            expect(() => readProfileExtensions(workFile)).toThrow(/EISDIR/);
        });
    });

    describe("migrateProfileExtensions", () => {
        it("a profile without a file gets all installed extensions with their install directory; the contents file is not touched", () => {
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

        it("with all files present, writes nothing and does not create the extensions directory", () => {
            writeProfileExtensions(workFile, []);

            expect(migrateProfileExtensions(extensionsDir, [workFile])).toEqual([]);
            expect(fs.existsSync(extensionsDir)).toBe(false);
        });

        it("several versions of one id on disk: one entry, the highest that is not marked for removal", () => {
            onDisk("acme.tools", "1.0.0");
            onDisk("acme.tools", "1.2.0");
            onDisk("acme.tools", "2.0.0");
            markObsolete(extensionsDir, ["acme.tools-2.0.0"]);

            migrateProfileExtensions(extensionsDir, [defaultFile]);

            expect(readProfileExtensions(defaultFile)).toEqual([entry("acme.tools", "1.2.0")]);
        });

        it("only marked versions on disk: the highest of them still goes in (nothing is hidden)", () => {
            onDisk("acme.tools", "1.0.0");
            onDisk("acme.tools", "1.2.0");
            markObsolete(extensionsDir, ["acme.tools-1.0.0", "acme.tools-1.2.0"]);

            migrateProfileExtensions(extensionsDir, [defaultFile]);

            expect(readProfileExtensions(defaultFile)).toEqual([entry("acme.tools", "1.2.0")]);
        });

        it("without installed extensions the contents are empty but the file is written", () => {
            expect(migrateProfileExtensions(extensionsDir, [defaultFile])).toEqual([defaultFile]);
            expect(ids(defaultFile)).toEqual([]);
        });
    });

    describe("profileExtensionsFiles", () => {
        it("known to the registry plus profile directories on disk, without duplicates; files in profilesHome are not profiles", () => {
            const profilesHome = ws.path("profiles");
            fs.mkdirSync(path.join(profilesHome, "work"), { recursive: true });
            fs.mkdirSync(path.join(profilesHome, "other"), { recursive: true });
            ws.writeFile("profiles/stray.txt", "");

            const files = profileExtensionsFiles([defaultFile, workFile], profilesHome);

            expect(files.sort()).toEqual(
                [defaultFile, workFile, path.join(profilesHome, "other", PROFILE_EXTENSIONS_FILE)].sort(),
            );
        });

        it("without a profiles directory, only known ones", () => {
            expect(profileExtensionsFiles([defaultFile], ws.path("missing"))).toEqual([defaultFile]);
        });
    });

    describe("referencedExtensionDirs", () => {
        it("the union of the directories all profiles point to; a profile without a file points to nothing", () => {
            onDisk("acme.tools", "1.0.0");
            onDisk("acme.tools", "1.1.0");
            onDisk("acme.base");
            writeProfileExtensions(defaultFile, [entry("acme.tools", "1.0.0")]);
            writeProfileExtensions(workFile, [entry("acme.tools", "1.1.0"), entry("acme.base", "1.0.0")]);

            expect(referencedExtensionDirs(extensionsDir, [defaultFile, workFile, ws.path("none.json")])).toEqual(
                new Set(["acme.tools-1.0.0", "acme.tools-1.1.0", "acme.base-1.0.0"]),
            );
        });

        it("a marked directory a profile points to is still referenced (cleanup unmarks it)", () => {
            onDisk("acme.tools");
            markObsolete(extensionsDir, ["acme.tools-1.0.0"]);
            writeProfileExtensions(defaultFile, [entry("acme.tools", "1.0.0")]);

            expect(referencedExtensionDirs(extensionsDir, [defaultFile])).toEqual(new Set(["acme.tools-1.0.0"]));
        });

        it("an old entry without a directory of its own does not fall back to a marked version", () => {
            onDisk("acme.tools", "1.1.0");
            markObsolete(extensionsDir, ["acme.tools-1.1.0"]);
            writeProfileExtensions(defaultFile, [{ identifier: { id: "acme.tools" }, version: "1.0.0" }]);

            expect(referencedExtensionDirs(extensionsDir, [defaultFile])).toEqual(new Set());
        });

        it("an unreadable profile is an error: nobody can tell what it holds", () => {
            ws.writeFile("profiles/work/extensions.json", "{");

            expect(() => referencedExtensionDirs(extensionsDir, [workFile])).toThrow(
                "Invalid extensions profile content",
            );
        });
    });

    describe("markUnusedExtensions (US-0.8)", () => {
        it("marks the versions no profile points to and deletes nothing (id is case-insensitive)", () => {
            onDisk("acme.tools");
            onDisk("acme.tools", "2.0.0");
            onDisk("acme.base");
            onDisk("acme.orphan");
            writeProfileExtensions(defaultFile, [
                { identifier: { id: "ACME.Tools" }, version: "2.0.0", relativeLocation: "acme.tools-2.0.0" },
            ]);
            writeProfileExtensions(workFile, [entry("acme.base", "1.0.0")]);

            expect(names(markUnusedExtensions(extensionsDir, [defaultFile, workFile]))).toEqual([
                "acme.orphan@1.0.0",
                "acme.tools@1.0.0",
            ]);
            expect(readObsolete(extensionsDir)).toEqual(new Set(["acme.orphan-1.0.0", "acme.tools-1.0.0"]));
            expect(fs.existsSync(ws.path("extensions/acme.orphan-1.0.0"))).toBe(true);
            expect(fs.existsSync(ws.path("extensions/acme.tools-1.0.0"))).toBe(true);
        });

        it("with candidates, only among them; an already marked version is not reported again", () => {
            onDisk("acme.one");
            onDisk("acme.two");
            onDisk("acme.two", "2.0.0");
            markObsolete(extensionsDir, ["acme.two-1.0.0"]);
            writeProfileExtensions(defaultFile, []);

            expect(names(markUnusedExtensions(extensionsDir, [defaultFile], ["ACME.TWO"]))).toEqual(["acme.two@2.0.0"]);
            expect(readObsolete(extensionsDir)).toEqual(new Set(["acme.two-1.0.0", "acme.two-2.0.0"]));
        });

        it("a candidate version a profile points to again is unmarked", () => {
            onDisk("acme.one");
            markObsolete(extensionsDir, ["acme.one-1.0.0"]);
            writeProfileExtensions(defaultFile, [entry("acme.one", "1.0.0")]);

            expect(markUnusedExtensions(extensionsDir, [defaultFile], ["acme.one"])).toEqual([]);
            expect(fs.existsSync(ws.path(`extensions/${OBSOLETE_FILE}`))).toBe(false);
        });

        it("an unreadable profile file means nothing is marked", () => {
            onDisk("acme.one");
            writeProfileExtensions(defaultFile, []);
            ws.writeFile("profiles/work/extensions.json", "{");

            expect(markUnusedExtensions(extensionsDir, [defaultFile, workFile])).toEqual([]);
            expect(fs.existsSync(ws.path(`extensions/${OBSOLETE_FILE}`))).toBe(false);
        });
    });

    describe("ProfileExtensions.list", () => {
        it("returns the installed extensions of the profile, sorted; an entry without a directory on disk is hidden", () => {
            onDisk("acme.tools");
            onDisk("acme.other");
            onDisk("acme.base");
            writeProfileExtensions(workFile, [
                { identifier: { id: "Acme.Tools" }, version: "1.0.0" },
                { identifier: { id: "acme.gone" }, version: "1.0.0" },
                entry("acme.base", "1.0.0"),
            ]);

            expect(names(profile(workFile).list())).toEqual(["acme.base@1.0.0", "acme.tools@1.0.0"]);
            expect(profile(workFile).extensionsDir).toBe(extensionsDir);
        });

        it("no file gives nothing; an unreadable one gives nothing and logs an error", () => {
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

        it.each([
            ["1.0.0", "acme.tools@1.0.0"],
            ["1.1.0", "acme.tools@1.1.0"],
        ])("US-0.3: with two versions on disk, the one the profile points to (%s) is listed", (version, expected) => {
            // Created in the order that would put the other version first in readdir on most file systems.
            onDisk("acme.tools", version === "1.0.0" ? "1.1.0" : "1.0.0");
            onDisk("acme.tools", version);
            writeProfileExtensions(workFile, [entry("acme.tools", version)]);

            expect(names(profile(workFile).list())).toEqual([expected]);
        });

        it("relativeLocation wins over the version field", () => {
            onDisk("acme.tools", "1.0.0");
            onDisk("acme.tools", "1.1.0");
            writeProfileExtensions(workFile, [
                { identifier: { id: "acme.tools" }, version: "1.1.0", relativeLocation: "acme.tools-1.0.0" },
            ]);

            expect(names(profile(workFile).list())).toEqual(["acme.tools@1.0.0"]);
        });

        it("relativeLocation pointing to another extension's directory is not trusted", () => {
            onDisk("acme.tools", "1.0.0");
            onDisk("acme.evil", "1.0.0");
            writeProfileExtensions(workFile, [
                { identifier: { id: "acme.tools" }, version: "1.0.0", relativeLocation: "acme.evil-1.0.0" },
            ]);

            expect(names(profile(workFile).list())).toEqual(["acme.tools@1.0.0"]);
        });

        it("a duplicated entry of one id gives one extension, the first entry wins", () => {
            onDisk("acme.tools", "1.0.0");
            onDisk("acme.tools", "1.1.0");
            writeProfileExtensions(workFile, [entry("acme.tools", "1.1.0"), entry("ACME.tools", "1.0.0")]);

            expect(names(profile(workFile).list())).toEqual(["acme.tools@1.1.0"]);
        });

        it("US-0.3: a directory marked for removal is never listed, even if the profile points to it", () => {
            onDisk("acme.tools", "1.0.0");
            onDisk("acme.tools", "1.1.0");
            markObsolete(extensionsDir, ["acme.tools-1.0.0"]);
            writeProfileExtensions(workFile, [entry("acme.tools", "1.0.0")]);
            const logger = fakeLogger();

            expect(profile(workFile, [], logger).list()).toEqual([]);
            expect(logger.warn).toHaveBeenCalledWith(
                `Extension acme.tools in ${workFile} points to acme.tools-1.0.0, which is marked for removal; skipping it`,
            );
        });

        it("a broken .obsolete does not hide anything", () => {
            onDisk("acme.tools");
            ws.writeFile(`extensions/${OBSOLETE_FILE}`, "[");
            writeProfileExtensions(workFile, [entry("acme.tools", "1.0.0")]);

            expect(names(profile(workFile).list())).toEqual(["acme.tools@1.0.0"]);
        });

        describe("US-0.9: entries written by older versions", () => {
            it("no relativeLocation: the <id>-<version> directory (id case-insensitive)", () => {
                onDisk("acme.tools", "1.0.0");
                onDisk("acme.tools", "1.1.0");
                writeProfileExtensions(workFile, [{ identifier: { id: "Acme.Tools" }, version: "1.0.0" }]);

                expect(names(profile(workFile).list())).toEqual(["acme.tools@1.0.0"]);
            });

            it("a directory under another name (fixture `tab-setter`) is found by its manifest", () => {
                ws.writeFile(
                    "extensions/tab-setter/package.json",
                    JSON.stringify({ publisher: "test", name: "tab-setter", version: "0.0.1" }),
                );
                writeProfileExtensions(workFile, [{ identifier: { id: "test.tab-setter" }, version: "0.0.1" }]);

                expect(
                    profile(workFile)
                        .list()
                        .map((e) => path.basename(e.dir)),
                ).toEqual(["tab-setter"]);
            });

            it("no such version: the only directory of the id, silently", () => {
                onDisk("acme.tools", "2.0.0");
                writeProfileExtensions(workFile, [{ identifier: { id: "acme.tools" }, version: "0.1.0" }]);
                const logger = fakeLogger();

                expect(names(profile(workFile, [], logger).list())).toEqual(["acme.tools@2.0.0"]);
                expect(logger.warn).not.toHaveBeenCalled();
            });

            it("several: the highest by semver with a warning; marked ones don't count; the file is not rewritten", () => {
                onDisk("acme.tools", "1.9.0");
                onDisk("acme.tools", "1.10.0");
                onDisk("acme.tools", "1.10.0-beta.1");
                onDisk("acme.tools", "2.0.0");
                markObsolete(extensionsDir, ["acme.tools-2.0.0"]);
                const text = JSON.stringify([{ identifier: { id: "acme.tools" }, version: "0.1.0" }]);
                ws.writeFile("profiles/work/extensions.json", text);
                const logger = fakeLogger();

                expect(names(profile(workFile, [], logger).list())).toEqual(["acme.tools@1.10.0"]);
                expect(logger.warn).toHaveBeenCalledWith(
                    `Extension acme.tools@0.1.0 in ${workFile} has no directory; using the highest of 1.9.0, 1.10.0-beta.1, 1.10.0`,
                );
                expect(fs.readFileSync(workFile, "utf8")).toBe(text);
            });
        });
    });

    describe("compareLooseVersions", () => {
        it.each([
            ["1.10.0", "1.9.0", 1],
            ["1.9.0", "1.10.0", -1],
            ["2.0.0", "2.0.0", 0],
            ["2.0.0", "2.0.0-rc.1", 1],
            ["2.0.0-rc.1", "2.0.0", -1],
            ["2.0.0-rc.2", "2.0.0-rc.1", 1],
            ["1.0", "1.0.1", -1],
            ["1.0.0+build.5", "1.0.0", 0],
            ["1.0.1+build", "1.0.0", 1],
            ["2.0.0-zz", "2.0.0", -1],
            ["2.0.0-rc.10", "2.0.0-rc.2", 1],
            ["1.0.0-a-b", "1.0.0-ab", -1],
            ["x.y", "0.0.1", -1],
        ])("%s vs %s → %d", (a, b, expected) => {
            expect(Math.sign(compareLooseVersions(a, b))).toBe(expected);
        });
    });

    describe("ProfileExtensions.add", () => {
        it("writes the version and directory of the version just installed, not of whatever is on disk", () => {
            onDisk("acme.tools", "1.0.0");
            const installed = onDisk("acme.tools", "0.9.0");

            profile(workFile).add([{ id: "acme.tools", dir: installed }]);

            expect(readProfileExtensions(workFile)).toEqual([entry("acme.tools", "0.9.0")]);
        });

        it("includes dependencies from disk, transitively, without duplicates; a missing dependency or a directory not on disk does not interfere", () => {
            const tools = onDisk("acme.tools", "1.0.0", ["ACME.base", "acme.missing"]);
            onDisk("acme.base", "2.0.0", ["acme.core", "acme.tools"]);
            onDisk("acme.core");
            onDisk("acme.unrelated");

            profile(workFile).add([
                { id: "acme.tools", dir: tools },
                { id: "acme.nothing", dir: ws.path("extensions/acme.nothing-1.0.0") },
            ]);

            expect(readProfileExtensions(workFile)).toEqual([
                entry("acme.tools", "1.0.0"),
                entry("acme.base", "2.0.0"),
                entry("acme.core", "1.0.0"),
            ]);
        });

        it("a dependency cycle among dependencies does not loop", () => {
            const tools = onDisk("acme.tools", "1.0.0", ["acme.a"]);
            onDisk("acme.a", "1.0.0", ["acme.b"]);
            onDisk("acme.b", "1.0.0", ["acme.a"]);

            profile(workFile).add([{ id: "acme.tools", dir: tools }]);

            expect(ids(workFile)).toEqual(["acme.tools", "acme.a", "acme.b"]);
        });

        it("a dependency already in the profile keeps its entry (its version and extra fields), and its own dependencies come too", () => {
            const tools = onDisk("acme.tools", "1.0.0", ["acme.base"]);
            onDisk("acme.base", "1.0.0", ["acme.core"]);
            onDisk("acme.base", "2.0.0", ["acme.core"]);
            onDisk("acme.core");
            const base = { ...entry("acme.base", "1.0.0"), metadata: { pinned: true } };
            ws.writeFile("profiles/work/extensions.json", JSON.stringify([base]));

            profile(workFile).add([{ id: "acme.tools", dir: tools }]);

            expect(readProfileExtensions(workFile)).toEqual([
                base,
                entry("acme.tools", "1.0.0"),
                entry("acme.core", "1.0.0"),
            ]);
        });

        it("a dependency new to the profile gets the highest version on disk, not a marked one when another exists", () => {
            const tools = onDisk("acme.tools", "1.0.0", ["acme.base"]);
            onDisk("acme.base", "1.0.0");
            onDisk("acme.base", "2.0.0");
            markObsolete(extensionsDir, ["acme.base-2.0.0"]);

            profile(workFile).add([{ id: "acme.tools", dir: tools }]);

            expect(ids(workFile)).toEqual(["acme.tools", "acme.base"]);
            expect(readProfileExtensions(workFile)?.[1]).toEqual(entry("acme.base", "1.0.0"));
        });

        it("a dependency present only as a marked version is taken and unmarked: the install did not download it", () => {
            const tools = onDisk("acme.tools", "1.0.0", ["acme.base"]);
            onDisk("acme.base", "1.0.0");
            markObsolete(extensionsDir, ["acme.base-1.0.0"]);

            profile(workFile).add([{ id: "acme.tools", dir: tools }]);

            expect(ids(workFile)).toEqual(["acme.tools", "acme.base"]);
            expect(fs.existsSync(ws.path(`extensions/${OBSOLETE_FILE}`))).toBe(false);
        });

        it("updates the entry of an already included extension (no duplicate) and leaves other entries and fields alone", () => {
            onDisk("acme.tools", "1.0.0");
            const next = onDisk("acme.tools", "2.0.0");
            ws.writeFile(
                "profiles/work/extensions.json",
                JSON.stringify([
                    { identifier: { id: "Acme.Tools" }, version: "1.0.0" },
                    { identifier: { id: "x.y" }, version: "3.0.0", metadata: { pinned: true } },
                ]),
            );

            profile(workFile).add([{ id: "acme.tools", dir: next }]);

            expect(readProfileExtensions(workFile)).toEqual([
                { identifier: { id: "x.y" }, version: "3.0.0", metadata: { pinned: true } },
                entry("acme.tools", "2.0.0"),
            ]);
        });

        it("US-0.1: the replaced version goes to .obsolete and stays on disk", () => {
            onDisk("acme.tools", "1.0.0");
            const next = onDisk("acme.tools", "1.1.0");
            writeProfileExtensions(workFile, [entry("acme.tools", "1.0.0")]);

            const { obsolete } = profile(workFile).add([{ id: "acme.tools", dir: next }]);

            expect(names(obsolete)).toEqual(["acme.tools@1.0.0"]);
            expect(readObsolete(extensionsDir)).toEqual(new Set(["acme.tools-1.0.0"]));
            expect(fs.existsSync(ws.path("extensions/acme.tools-1.0.0/package.json"))).toBe(true);
            expect(names(profile(workFile).list())).toEqual(["acme.tools@1.1.0"]);
        });

        it("US-0.5: installing the marked version again unmarks it and marks the one it replaces", () => {
            const first = onDisk("acme.tools", "1.0.0");
            const next = onDisk("acme.tools", "1.1.0");
            writeProfileExtensions(workFile, [entry("acme.tools", "1.0.0")]);
            profile(workFile).add([{ id: "acme.tools", dir: next }]);

            const { obsolete } = profile(workFile).add([{ id: "acme.tools", dir: first }]);

            expect(names(obsolete)).toEqual(["acme.tools@1.1.0"]);
            expect(readObsolete(extensionsDir)).toEqual(new Set(["acme.tools-1.1.0"]));
            expect(names(profile(workFile).list())).toEqual(["acme.tools@1.0.0"]);
        });

        it("US-0.6: an update in one profile does not touch another profile's entry, and its version is not marked", () => {
            onDisk("acme.tools", "1.0.0");
            const next = onDisk("acme.tools", "1.1.0");
            writeProfileExtensions(workFile, [entry("acme.tools", "1.0.0")]);
            writeProfileExtensions(defaultFile, [entry("acme.tools", "1.0.0")]);

            const { obsolete } = profile(workFile, [defaultFile]).add([{ id: "acme.tools", dir: next }]);

            expect(obsolete).toEqual([]);
            expect(fs.existsSync(ws.path(`extensions/${OBSOLETE_FILE}`))).toBe(false);
            expect(names(profile(workFile).list())).toEqual(["acme.tools@1.1.0"]);
            expect(names(profile(defaultFile).list())).toEqual(["acme.tools@1.0.0"]);
        });

        it("another profile that can't be read: nothing is marked, and the reason is logged", () => {
            onDisk("acme.tools", "1.0.0");
            const next = onDisk("acme.tools", "1.1.0");
            writeProfileExtensions(workFile, [entry("acme.tools", "1.0.0")]);
            ws.writeFile("extensions/extensions.json", "{");
            const logger = fakeLogger();

            const { obsolete } = profile(workFile, [defaultFile], logger).add([{ id: "acme.tools", dir: next }]);

            expect(obsolete).toEqual([]);
            expect(logger.warn).toHaveBeenCalledWith(
                "Failed to read profile extensions; no extension is marked for removal",
                expect.objectContaining({ message: `Invalid extensions profile content in ${defaultFile}` }),
            );
            expect(names(profile(workFile).list())).toEqual(["acme.tools@1.1.0"]);
            expect(fs.existsSync(ws.path(`extensions/${OBSOLETE_FILE}`))).toBe(false);
        });

        it("to an unreadable file fails and the file is not overwritten", () => {
            const tools = onDisk("acme.tools");
            ws.writeFile("profiles/work/extensions.json", "{");

            expect(() => {
                profile(workFile).add([{ id: "acme.tools", dir: tools }]);
            }).toThrow("Invalid extensions profile content");
            expect(fs.readFileSync(workFile, "utf8")).toBe("{");
        });
    });

    describe("ProfileExtensions.remove (US-0.4)", () => {
        it("absent from the profile changes nothing", () => {
            onDisk("acme.tools");
            writeProfileExtensions(workFile, [{ identifier: { id: "x.y" }, version: "1.0.0" }]);
            const before = fs.statSync(workFile).mtimeMs;

            expect(profile(workFile).remove("acme.tools")).toEqual({ removed: false, obsolete: [] });
            expect(fs.statSync(workFile).mtimeMs).toBe(before);
            expect(profile(defaultFile).remove("acme.tools")).toEqual({ removed: false, obsolete: [] });
            expect(fs.existsSync(defaultFile)).toBe(false);
            expect(fs.existsSync(ws.path(`extensions/${OBSOLETE_FILE}`))).toBe(false);
        });

        it("no longer needed by anyone: marked for removal, the directory stays until the next start", () => {
            onDisk("acme.tools");
            onDisk("acme.orphan");
            writeProfileExtensions(workFile, [
                { identifier: { id: "acme.tools" }, version: "1.0.0" },
                { identifier: { id: "x.y" }, version: "1.0.0" },
            ]);
            writeProfileExtensions(defaultFile, []);
            const logger = fakeLogger();

            const result = profile(workFile, [defaultFile], logger).remove("ACME.TOOLS");

            expect(result.removed).toBe(true);
            expect(names(result.obsolete)).toEqual(["acme.tools@1.0.0"]);
            expect(logger.info).not.toHaveBeenCalled();
            expect(ids(workFile)).toEqual(["x.y"]);
            expect(readObsolete(extensionsDir)).toEqual(new Set(["acme.tools-1.0.0"]));
            expect(fs.existsSync(ws.path("extensions/acme.tools-1.0.0"))).toBe(true);
        });

        it("needed by another profile: not marked, and the reason is logged", () => {
            onDisk("acme.tools");
            writeProfileExtensions(workFile, [{ identifier: { id: "acme.tools" }, version: "1.0.0" }]);
            writeProfileExtensions(defaultFile, [{ identifier: { id: "acme.tools" }, version: "1.0.0" }]);
            const logger = fakeLogger();

            expect(profile(workFile, [defaultFile], logger).remove("acme.tools")).toEqual({
                removed: true,
                obsolete: [],
            });
            expect(ids(workFile)).toEqual([]);
            expect(fs.existsSync(ws.path(`extensions/${OBSOLETE_FILE}`))).toBe(false);
            expect(logger.info).toHaveBeenCalledWith("Extension acme.tools is kept on disk: another profile uses it");
        });

        it("every version of the id that nobody needs is marked, the one another profile uses is not", () => {
            onDisk("acme.tools", "1.0.0");
            onDisk("acme.tools", "1.1.0");
            writeProfileExtensions(workFile, [entry("acme.tools", "1.1.0")]);
            writeProfileExtensions(defaultFile, [entry("acme.tools", "1.0.0")]);

            const { obsolete } = profile(workFile, [defaultFile]).remove("acme.tools");

            expect(names(obsolete)).toEqual(["acme.tools@1.1.0"]);
        });
    });

    describe("createProfileExtensions", () => {
        it("profile files come from the registry and disk: an extension of a profile unknown to the registry is not marked", () => {
            onDisk("acme.tools");
            writeProfileExtensions(defaultFile, [{ identifier: { id: "acme.tools" }, version: "1.0.0" }]);
            // Created by another window: this process's registry doesn't know it.
            const foreign = ws.path("profiles/foreign/extensions.json");
            writeProfileExtensions(foreign, [{ identifier: { id: "acme.tools" }, version: "1.0.0" }]);

            const logger = fakeLogger();
            const extensions = createProfileExtensions({
                extensionsDir,
                profile: { extensionsResource: defaultFile },
                profiles: { profilesHome: ws.path("profiles"), profiles: [{ extensionsResource: defaultFile }] },
                logger,
            });

            expect(extensions.remove("acme.tools")).toEqual({ removed: true, obsolete: [] });
            expect(logger.info).toHaveBeenCalled();

            const last = createProfileExtensions({
                extensionsDir,
                profile: { extensionsResource: foreign },
                profiles: { profilesHome: ws.path("profiles"), profiles: [{ extensionsResource: defaultFile }] },
            });
            expect(names(last.remove("acme.tools").obsolete)).toEqual(["acme.tools@1.0.0"]);
        });
    });
});
