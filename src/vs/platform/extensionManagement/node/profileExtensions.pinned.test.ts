import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";

import {
    type IStoredProfileExtension,
    PROFILE_EXTENSIONS_FILE,
    ProfileExtensions,
    readProfileExtensions,
    writeProfileExtensions,
} from "./profileExtensions.ts";

/**
 * ExtensionUpdates stage 1: `metadata.pinned` follows upstream
 * `pinned: installGivenVersion ? true : (options.pinned ?? existing.pinned)`, dependencies are never pinned.
 */
describe("ProfileExtensions pinned", () => {
    let ws: ITempWorkspace;
    let extensionsDir: string;
    let defaultFile: string;
    let workFile: string;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-profile-pinned-" });
        extensionsDir = ws.path("extensions");
        defaultFile = path.join(extensionsDir, PROFILE_EXTENSIONS_FILE);
        workFile = ws.path("profiles/work/extensions.json");
    });

    afterEach(() => {
        ws.dispose();
    });

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

    function entry(id: string, version: string, extra: Record<string, unknown> = {}): IStoredProfileExtension {
        return { identifier: { id }, version, relativeLocation: `${id}-${version}`, ...extra };
    }

    function profile(file: string, others: string[] = []): ProfileExtensions {
        return new ProfileExtensions({ extensionsDir, profileFile: file, allProfileFiles: () => [file, ...others] });
    }

    it("US-1.2: a given version is written pinned", () => {
        onDisk("acme.demo", "1.1.0");
        const old = onDisk("acme.demo", "1.0.0");
        writeProfileExtensions(workFile, [entry("acme.demo", "1.1.0")]);

        profile(workFile).add([{ id: "acme.demo", dir: old }], { pinned: true });

        expect(readProfileExtensions(workFile)).toEqual([entry("acme.demo", "1.0.0", { metadata: { pinned: true } })]);
    });

    it("US-1.7: a plain update keeps the pin, the other metadata and the entry's unknown fields", () => {
        onDisk("acme.demo", "1.0.0");
        const next = onDisk("acme.demo", "1.1.0");
        writeProfileExtensions(workFile, [
            entry("acme.demo", "1.0.0", { metadata: { pinned: true, source: "gallery" }, location: { x: 1 } }),
        ]);

        profile(workFile).add([{ id: "acme.demo", dir: next }]);

        expect(readProfileExtensions(workFile)).toEqual([
            entry("acme.demo", "1.1.0", { metadata: { pinned: true, source: "gallery" }, location: { x: 1 } }),
        ]);
    });

    it("a plain install of a new entry is not pinned and gets no metadata; an unpinned entry's metadata stays as is", () => {
        const demo = onDisk("acme.demo");
        const tools = onDisk("acme.tools", "2.0.0");
        writeProfileExtensions(workFile, [entry("acme.tools", "1.0.0", { metadata: { source: "vsix" } })]);

        profile(workFile).add([
            { id: "acme.demo", dir: demo },
            { id: "acme.tools", dir: tools },
        ]);

        expect(readProfileExtensions(workFile)).toEqual([
            entry("acme.demo", "1.0.0"),
            entry("acme.tools", "2.0.0", { metadata: { source: "vsix" } }),
        ]);
    });

    it("an explicit pinned: false is written, like upstream options.pinned", () => {
        const demo = onDisk("acme.demo");
        writeProfileExtensions(workFile, [entry("acme.demo", "1.0.0", { metadata: { pinned: true } })]);

        profile(workFile).add([{ id: "acme.demo", dir: demo }], { pinned: false });

        expect(readProfileExtensions(workFile)).toEqual([entry("acme.demo", "1.0.0", { metadata: { pinned: false } })]);
    });

    it("dependencies are never pinned, only the extensions given", () => {
        const demo = onDisk("acme.demo", "1.0.0", ["acme.base"]);
        onDisk("acme.base");

        profile(workFile).add([{ id: "acme.demo", dir: demo }], { pinned: true });

        expect(readProfileExtensions(workFile)).toEqual([
            entry("acme.demo", "1.0.0", { metadata: { pinned: true } }),
            entry("acme.base", "1.0.0"),
        ]);
    });

    it("dependencies installed together with a given version are written unpinned (QA report #1)", () => {
        const demo = onDisk("acme.demo", "1.0.0", ["acme.base"]);
        const base = onDisk("acme.base", "2.0.0");
        onDisk("acme.base", "3.0.0");

        profile(workFile).add([{ id: "acme.demo", dir: demo }], {
            pinned: true,
            dependencies: [{ id: "acme.base", dir: base }],
        });

        // Exactly the directory installed with it, not the highest on disk.
        expect(readProfileExtensions(workFile)).toEqual([
            entry("acme.demo", "1.0.0", { metadata: { pinned: true } }),
            entry("acme.base", "2.0.0"),
        ]);
    });

    it("a dependency already in the profile keeps its entry and its pin; one not on disk is skipped", () => {
        const demo = onDisk("acme.demo", "1.0.0", ["acme.base"]);
        onDisk("acme.base", "1.0.0");
        const newer = onDisk("acme.base", "2.0.0");
        const pinnedBase = entry("acme.base", "1.0.0", { metadata: { pinned: true } });
        writeProfileExtensions(workFile, [pinnedBase]);

        profile(workFile).add([{ id: "acme.demo", dir: demo }], {
            pinned: true,
            dependencies: [
                { id: "acme.base", dir: newer },
                { id: "acme.gone", dir: ws.path("extensions/acme.gone-1.0.0") },
            ],
        });

        expect(readProfileExtensions(workFile)).toEqual([
            pinnedBase,
            entry("acme.demo", "1.0.0", { metadata: { pinned: true } }),
        ]);
    });

    it("US-1.8: uninstall drops the pin together with the entry; the next plain install is not pinned", () => {
        const demo = onDisk("acme.demo");
        const work = profile(workFile);
        work.add([{ id: "acme.demo", dir: demo }], { pinned: true });

        work.remove("acme.demo");
        work.add([{ id: "acme.demo", dir: demo }]);

        expect(readProfileExtensions(workFile)).toEqual([entry("acme.demo", "1.0.0")]);
    });

    it("US-1.9: pinning in one profile leaves the other profile's entry alone", () => {
        onDisk("acme.demo", "1.1.0");
        const old = onDisk("acme.demo", "1.0.0");
        writeProfileExtensions(workFile, [entry("acme.demo", "1.1.0")]);
        writeProfileExtensions(defaultFile, [entry("acme.demo", "1.1.0")]);

        profile(workFile, [defaultFile]).add([{ id: "acme.demo", dir: old }], { pinned: true });

        expect(readProfileExtensions(defaultFile)).toEqual([entry("acme.demo", "1.1.0")]);
        expect(
            profile(defaultFile)
                .list()
                .map((e) => e.pinned),
        ).toEqual([false]);
    });

    it("list() reports the pin; anything but true is not pinned", () => {
        onDisk("acme.a");
        onDisk("acme.b");
        onDisk("acme.c");
        writeProfileExtensions(workFile, [
            entry("acme.a", "1.0.0", { metadata: { pinned: true } }),
            entry("acme.b", "1.0.0", { metadata: { pinned: "yes" } }),
            entry("acme.c", "1.0.0"),
        ]);

        expect(
            profile(workFile)
                .list()
                .map((e) => `${e.id}:${String(e.pinned)}`),
        ).toEqual(["acme.a:true", "acme.b:false", "acme.c:false"]);
    });
});
