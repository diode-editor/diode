import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import type { ILogger } from "../../log/common/iLogger.ts";

import {
    cleanUpExtensions,
    EXTENSION_LEASES_DIR,
    installTempPrefix,
    isExtensionDirName,
    isProcessAlive,
    markObsolete,
    OBSOLETE_FILE,
    readObsolete,
    releaseExtensionLease,
    unmarkObsolete,
    writeExtensionLease,
} from "./obsoleteExtensions.ts";

function fakeLogger(): ILogger {
    return { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), isEnabled: () => true };
}

describe("obsoleteExtensions", () => {
    let ws: ITempWorkspace;
    let extensionsDir: string;
    let obsoleteFile: string;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-obsolete-extensions-" });
        extensionsDir = ws.path("extensions");
        obsoleteFile = path.join(extensionsDir, OBSOLETE_FILE);
    });

    afterEach(() => {
        ws.dispose();
    });

    function onDisk(name: string): string {
        return ws.writeFile(`extensions/${name}/package.json`, "{}");
    }

    function exists(name: string): boolean {
        return fs.existsSync(path.join(extensionsDir, name));
    }

    function obsoleteJson(): unknown {
        return JSON.parse(fs.readFileSync(obsoleteFile, "utf8"));
    }

    describe("isExtensionDirName", () => {
        it.each([
            ["acme.demo-1.0.0", true],
            ["tab-setter", true],
            [OBSOLETE_FILE, false],
            [EXTENSION_LEASES_DIR, false],
            [".vsix-install-42-abc", false],
            ["acme.demo-1.0.0.1f2e.vsctmp", false],
        ])("%s → %s", (name, expected) => {
            expect(isExtensionDirName(name)).toBe(expected);
        });
    });

    describe("readObsolete / markObsolete / unmarkObsolete", () => {
        it("no file is an empty set; mark writes the upstream format {name: true}", () => {
            expect(readObsolete(extensionsDir)).toEqual(new Set());

            markObsolete(extensionsDir, ["acme.demo-1.0.0"]);
            markObsolete(extensionsDir, ["acme.demo-1.0.0", "acme.other-2.0.0"]);

            expect(obsoleteJson()).toEqual({ "acme.demo-1.0.0": true, "acme.other-2.0.0": true });
            expect(readObsolete(extensionsDir)).toEqual(new Set(["acme.demo-1.0.0", "acme.other-2.0.0"]));
            // Via a temp file: nothing else is left next to it.
            expect(fs.readdirSync(extensionsDir)).toEqual([OBSOLETE_FILE]);
        });

        it("marking nothing does not create the file", () => {
            markObsolete(extensionsDir, []);

            expect(fs.existsSync(extensionsDir)).toBe(false);
        });

        it("unmark returns what was actually marked; the last one removes the file", () => {
            markObsolete(extensionsDir, ["a.b-1.0.0", "a.b-2.0.0"]);

            expect(unmarkObsolete(extensionsDir, ["a.b-1.0.0", "x.y-1.0.0"])).toEqual(["a.b-1.0.0"]);
            expect(obsoleteJson()).toEqual({ "a.b-2.0.0": true });

            expect(unmarkObsolete(extensionsDir, ["a.b-2.0.0"])).toEqual(["a.b-2.0.0"]);
            expect(fs.existsSync(obsoleteFile)).toBe(false);
        });

        it("unmark without a file or without a hit writes nothing", () => {
            expect(unmarkObsolete(extensionsDir, ["a.b-1.0.0"])).toEqual([]);
            expect(fs.existsSync(extensionsDir)).toBe(false);

            markObsolete(extensionsDir, ["a.b-2.0.0"]);
            const before = fs.statSync(obsoleteFile).mtimeMs;
            expect(unmarkObsolete(extensionsDir, ["a.b-1.0.0"])).toEqual([]);
            expect(fs.statSync(obsoleteFile).mtimeMs).toBe(before);
        });

        it("a false value is not a mark (only `true` counts, like upstream)", () => {
            ws.writeFile(`extensions/${OBSOLETE_FILE}`, JSON.stringify({ "a.b-1.0.0": false, "a.b-2.0.0": true }));

            expect(readObsolete(extensionsDir)).toEqual(new Set(["a.b-2.0.0"]));
        });

        it.each([
            ["malformed JSON", "{"],
            ["an array", `["a.b-1.0.0"]`],
            ["null", "null"],
        ])("%s: read throws, mark and unmark start over (upstream ignores a broken file)", (_what, text) => {
            ws.writeFile(`extensions/${OBSOLETE_FILE}`, text);

            expect(() => readObsolete(extensionsDir)).toThrow(`Invalid ${obsoleteFile}`);
            expect(unmarkObsolete(extensionsDir, ["a.b-1.0.0"])).toEqual([]);
            markObsolete(extensionsDir, ["a.b-1.0.0"]);
            expect(obsoleteJson()).toEqual({ "a.b-1.0.0": true });
        });

        it("a non-ENOENT read error is thrown as is", () => {
            fs.mkdirSync(obsoleteFile, { recursive: true });

            expect(() => readObsolete(extensionsDir)).toThrow(/EISDIR/);
        });
    });

    describe("leases", () => {
        it("write puts the loaded directories into .inuse/<pid>.json, release removes it", () => {
            writeExtensionLease(extensionsDir, ["acme.demo-1.0.0"], 4242);

            const file = path.join(extensionsDir, EXTENSION_LEASES_DIR, "4242.json");
            expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(["acme.demo-1.0.0"]);
            expect(fs.readdirSync(path.dirname(file))).toEqual(["4242.json"]);

            releaseExtensionLease(extensionsDir, 4242);
            expect(fs.existsSync(file)).toBe(false);
            // A repeated release is a no-op.
            releaseExtensionLease(extensionsDir, 4242);
        });

        it("the default pid is this process", () => {
            writeExtensionLease(extensionsDir, []);

            expect(fs.readdirSync(path.join(extensionsDir, EXTENSION_LEASES_DIR))).toEqual([
                `${String(process.pid)}.json`,
            ]);
            releaseExtensionLease(extensionsDir);
            expect(fs.readdirSync(path.join(extensionsDir, EXTENSION_LEASES_DIR))).toEqual([]);
        });

        it("isProcessAlive: this process is alive, a pid nobody has is not", () => {
            expect(isProcessAlive(process.pid)).toBe(true);
            expect(isProcessAlive(2 ** 30)).toBe(false);
        });

        it("installTempPrefix carries the pid", () => {
            expect(installTempPrefix(42)).toBe(".vsix-install-42-");
            expect(installTempPrefix()).toBe(`.vsix-install-${String(process.pid)}-`);
        });
    });

    describe("cleanUpExtensions (US-0.10)", () => {
        function cleanUp(
            options: {
                referenced?: string[];
                alive?: number[];
                logger?: ILogger;
                referencedDirs?: () => Set<string>;
            } = {},
        ): string[] {
            return cleanUpExtensions(extensionsDir, {
                referencedDirs: options.referencedDirs ?? (() => new Set(options.referenced ?? [])),
                logger: options.logger ?? fakeLogger(),
                isAlive: (pid) => (options.alive ?? []).includes(pid),
            });
        }

        it("no .obsolete: neither profiles nor the extensions directory are read", () => {
            onDisk("acme.demo-1.0.0");
            ws.writeFile("extensions/acme.demo-1.0.0.ab12.vsctmp/package.json", "{}");
            const referencedDirs = vi.fn(() => new Set<string>());

            expect(cleanUp({ referencedDirs })).toEqual([]);

            expect(referencedDirs).not.toHaveBeenCalled();
            // The leftover sweep did not run either.
            expect(exists("acme.demo-1.0.0.ab12.vsctmp")).toBe(true);
        });

        it("deletes marked directories nobody references and removes the file once empty (US-0.2)", () => {
            onDisk("acme.demo-1.0.0");
            onDisk("acme.demo-1.1.0");
            markObsolete(extensionsDir, ["acme.demo-1.0.0"]);
            const logger = fakeLogger();

            expect(cleanUp({ referenced: ["acme.demo-1.1.0"], logger })).toEqual(["acme.demo-1.0.0"]);

            expect(exists("acme.demo-1.0.0")).toBe(false);
            expect(exists("acme.demo-1.1.0")).toBe(true);
            expect(fs.existsSync(obsoleteFile)).toBe(false);
            expect(logger.info).toHaveBeenCalledWith("Deleted extensions marked for removal", {
                deleted: ["acme.demo-1.0.0"],
            });
        });

        it("a marked directory that is already gone just loses its key", () => {
            markObsolete(extensionsDir, ["acme.gone-1.0.0"]);

            expect(cleanUp()).toEqual(["acme.gone-1.0.0"]);
            expect(fs.existsSync(obsoleteFile)).toBe(false);
        });

        it("a marked directory a profile references again is not deleted, the key is dropped", () => {
            onDisk("acme.demo-1.0.0");
            markObsolete(extensionsDir, ["acme.demo-1.0.0"]);

            expect(cleanUp({ referenced: ["acme.demo-1.0.0"] })).toEqual([]);

            expect(exists("acme.demo-1.0.0")).toBe(true);
            expect(fs.existsSync(obsoleteFile)).toBe(false);
        });

        it("broken .obsolete: error in the log, nothing deleted, the file is left for a person to look at", () => {
            onDisk("acme.demo-1.0.0");
            ws.writeFile(`extensions/${OBSOLETE_FILE}`, "[");
            const logger = fakeLogger();

            expect(cleanUp({ logger })).toEqual([]);

            expect(exists("acme.demo-1.0.0")).toBe(true);
            expect(fs.readFileSync(obsoleteFile, "utf8")).toBe("[");
            expect(logger.error).toHaveBeenCalledWith(
                "Failed to read extensions marked for removal; nothing is deleted",
                expect.objectContaining({ message: `Invalid ${obsoleteFile}` }),
            );
        });

        it("unreadable profiles: error in the log, nothing deleted", () => {
            onDisk("acme.demo-1.0.0");
            markObsolete(extensionsDir, ["acme.demo-1.0.0"]);
            const logger = fakeLogger();
            const failure = new Error("Invalid extensions profile content");

            expect(
                cleanUp({
                    logger,
                    referencedDirs: () => {
                        throw failure;
                    },
                }),
            ).toEqual([]);

            expect(exists("acme.demo-1.0.0")).toBe(true);
            expect(readObsolete(extensionsDir)).toEqual(new Set(["acme.demo-1.0.0"]));
            expect(logger.error).toHaveBeenCalledWith("Failed to read profile extensions; nothing is deleted", failure);
        });

        it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
            "a directory that fails to delete: warn, its key stays until the next start, the others are deleted",
            () => {
                onDisk("acme.stuck-1.0.0");
                onDisk("acme.demo-1.0.0");
                // A read-only subdirectory with a file in it: rm cannot empty it.
                const locked = ws.writeFile("extensions/acme.stuck-1.0.0/locked/file.txt", "x");
                fs.chmodSync(path.dirname(locked), 0o555);
                markObsolete(extensionsDir, ["acme.stuck-1.0.0", "acme.demo-1.0.0"]);
                const logger = fakeLogger();

                try {
                    expect(cleanUp({ logger })).toEqual(["acme.demo-1.0.0"]);
                } finally {
                    fs.chmodSync(path.dirname(locked), 0o755);
                }

                expect(exists("acme.demo-1.0.0")).toBe(false);
                expect(readObsolete(extensionsDir)).toEqual(new Set(["acme.stuck-1.0.0"]));
                expect(logger.warn).toHaveBeenCalledWith(
                    "Failed to delete extension acme.stuck-1.0.0; will retry on next start",
                    expect.objectContaining({ code: "EACCES" }),
                );
            },
        );

        it("a key that is not a plain directory name is dropped without touching anything outside", () => {
            ws.writeFile("outside/package.json", "{}");
            markObsolete(extensionsDir, ["../outside", "a/b", "", ".", ".."]);
            const logger = fakeLogger();

            expect(cleanUp({ logger })).toEqual([]);

            expect(fs.existsSync(ws.path("outside/package.json"))).toBe(true);
            expect(fs.existsSync(obsoleteFile)).toBe(false);
            expect(logger.warn).toHaveBeenCalledWith("Ignoring invalid entry in .obsolete: ../outside");
        });

        it("leases (decision V1): directories loaded by a live editor process stay, a dead process's lease is removed", () => {
            onDisk("acme.live-1.0.0");
            onDisk("acme.dead-1.0.0");
            writeExtensionLease(extensionsDir, ["acme.live-1.0.0"], 100);
            writeExtensionLease(extensionsDir, ["acme.dead-1.0.0"], 200);
            markObsolete(extensionsDir, ["acme.live-1.0.0", "acme.dead-1.0.0"]);

            expect(cleanUp({ alive: [100] })).toEqual(["acme.dead-1.0.0"]);

            expect(exists("acme.live-1.0.0")).toBe(true);
            expect(exists("acme.dead-1.0.0")).toBe(false);
            expect(readObsolete(extensionsDir)).toEqual(new Set(["acme.live-1.0.0"]));
            expect(fs.readdirSync(path.join(extensionsDir, EXTENSION_LEASES_DIR))).toEqual(["100.json"]);
        });

        it("an unreadable live lease protects everything; foreign files in .inuse are ignored", () => {
            onDisk("acme.demo-1.0.0");
            ws.writeFile(`extensions/${EXTENSION_LEASES_DIR}/100.json`, "{");
            ws.writeFile(`extensions/${EXTENSION_LEASES_DIR}/notes.txt`, "x");
            ws.writeFile(`extensions/${EXTENSION_LEASES_DIR}/100.json.4242.tmp`, "x");
            markObsolete(extensionsDir, ["acme.demo-1.0.0"]);
            const logger = fakeLogger();

            expect(cleanUp({ alive: [100], logger })).toEqual([]);

            expect(exists("acme.demo-1.0.0")).toBe(true);
            expect(logger.warn).toHaveBeenCalledWith(
                `Unreadable extension lease ${path.join(extensionsDir, EXTENSION_LEASES_DIR, "100.json")}; nothing is deleted`,
            );
            expect(fs.readdirSync(path.join(extensionsDir, EXTENSION_LEASES_DIR)).sort()).toEqual(
                ["100.json", "100.json.4242.tmp", "notes.txt"].sort(),
            );
        });

        it("sweeps leftovers: *.vsctmp always, install temps only of dead processes", () => {
            onDisk("acme.demo-1.0.0");
            onDisk("acme.demo-1.0.0.1f2e.vsctmp");
            onDisk(".vsix-install-200-abc");
            onDisk(".vsix-install-100-def");
            onDisk(".vsix-install-legacy");
            ws.writeFile("extensions/note.vsctmp", "a file, not a directory");
            markObsolete(extensionsDir, ["acme.other-1.0.0"]);

            cleanUp({ referenced: ["acme.demo-1.0.0"], alive: [100] });

            expect(fs.readdirSync(extensionsDir).sort()).toEqual(
                [".vsix-install-100-def", ".vsix-install-legacy", "acme.demo-1.0.0", "note.vsctmp"].sort(),
            );
        });

        it("a key marked by someone else during cleanup survives (only the handled keys are unmarked)", () => {
            onDisk("acme.demo-1.0.0");
            markObsolete(extensionsDir, ["acme.demo-1.0.0"]);

            cleanUp({
                referencedDirs: () => {
                    // Another process marks a version between the read and the write.
                    markObsolete(extensionsDir, ["acme.late-1.0.0"]);
                    return new Set();
                },
            });

            expect(readObsolete(extensionsDir)).toEqual(new Set(["acme.late-1.0.0"]));
        });
    });
});
