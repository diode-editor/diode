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
        ...overrides,
    };
}

describe("toExtensionRegistration", () => {
    it("without main there is nothing to register: null, the source is not read", async () => {
        const e = env();

        expect(await toExtensionRegistration(extension({ manifest: manifest() }), e)).toBeNull();
        expect(
            await toExtensionRegistration(extension({ manifest: manifest({ main: "" }), isBuiltin: true }), e),
        ).toBeNull();
        expect(e.reads).toEqual([]);
    });

    it("a user extension loads from disk: the install directory and main relative to it", async () => {
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

    it("a built-in loads as source from assets by a virtual path", async () => {
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

    it("the manifest travels whole (packageJSON in vscode.extensions), activation events as in the manifest", async () => {
        const m = manifest({ main: "ext.js", categories: ["AI"], activationEvents: ["onLanguage:python"] });

        const reg = await toExtensionRegistration(extension({ manifest: m }), env());

        expect(reg?.manifest).toBe(m);
        expect(reg?.activationEvents).toEqual(["onLanguage:python"]);
    });

    it("activation events are the full set: declared plus implicit ones from contributes", async () => {
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
        // No events means eager `*`: a deviation from upstream (computeActivationEvents).
        expect(bare?.activationEvents).toEqual(["*"]);
    });

    it("command titles and categories are for the palette", async () => {
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
    it("without commands there are no titles and no categories", () => {
        expect(collectCommandMeta(undefined)).toStrictEqual({});
        const empty = collectCommandMeta([]);
        expect(empty.titles).toBeUndefined();
        expect(empty.categories).toBeUndefined();
    });

    it("skips entries without a string id or title, and empty categories", () => {
        const meta = collectCommandMeta([
            { command: "a", title: "A", category: "" },
            { command: "b" } as never,
            { title: "C" } as never,
            { command: "d", title: "D", category: 7 } as never,
        ]);

        // Strict: a skipped entry must not leave a key with undefined.
        expect(meta.titles).toStrictEqual({ a: "A", d: "D" });
        expect(meta.categories).toBeUndefined();
    });
});
