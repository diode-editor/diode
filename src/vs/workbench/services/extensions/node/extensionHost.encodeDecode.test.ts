import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { type ILanguageService, NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";

const FIXTURE = extensionFixture("test.encoding", "encodesAndDecodes.cjs");

const TXT_IS_PLAINTEXT: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".txt") ? "plaintext" : undefined),
};

/** "Hellö Wörld" in windows-1252. */
const CP1252 = [72, 101, 108, 108, 0xf6, 32, 87, 0xf6, 114, 108, 100];
const HELLO_UTF16LE = [...Buffer.from("Hello", "utf16le")];
const HELLO_UTF16BE = [...Buffer.from("Hello", "utf16le").swap16()];
const HELLO_UTF8 = [...Buffer.from("Hellö")];

interface IDecoded {
    readonly text?: string;
    readonly error?: string;
}

interface IEncoded {
    readonly bytes: number[];
    readonly isBuffer: boolean;
    readonly asString: string;
}

type Options = { readonly path: string } | { readonly encoding: string } | undefined;

describe("ExtensionHost — workspace.decode / workspace.encode (subprocess)", () => {
    let dir: string;
    let userDir: string;
    let harness: IExtensionHarness | undefined;

    const start = async (configuration: Record<string, unknown> = {}): Promise<void> => {
        harness = await createExtensionTestHarness({
            extensions: [FIXTURE],
            workspaceFolders: [dir],
            userRoamingDataHome: userDir,
            configuration,
            languageService: TXT_IS_PLAINTEXT,
        });
    };

    const execute = <T>(id: string, ...args: unknown[]): Promise<T> => {
        if (harness === undefined) throw new Error("start() first");
        return harness.commandRegistry.execute(`test.encoding.${id}`, ...args) as Promise<T>;
    };
    const decode = (bytes: readonly number[], options?: Options): Promise<IDecoded> =>
        execute("decode", bytes, options);
    const encode = (text: string, options?: Options): Promise<IEncoded> => execute("encode", text, options);
    const inFolder = (...segments: string[]): { path: string } => ({ path: path.join(dir, ...segments) });

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-encode-decode-"));
        userDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-encode-decode-user-"));
    });

    afterEach(async () => {
        await harness?.dispose();
        harness = undefined;
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(userDir, { recursive: true, force: true });
    });

    it("[api:workspace.decode] without options: BOM, UTF-16 by zero bytes, binary throws", async () => {
        await start();
        expect(await decode(HELLO_UTF8)).toEqual({ text: "Hellö" });
        expect(await decode([0xef, 0xbb, 0xbf, ...Buffer.from("Hi")])).toEqual({ text: "Hi" });
        expect(await decode([0xfe, 0xff, ...HELLO_UTF16BE])).toEqual({ text: "Hello" });
        expect(await decode(HELLO_UTF16LE)).toEqual({ text: "Hello" });
        expect(await decode(HELLO_UTF16BE)).toEqual({ text: "Hello" });
        expect(await decode([0, 0, 0, 0])).toEqual({
            error: "Stream is binary but only text is accepted for decoding",
        });
    });

    it("[api:workspace.decode] an explicit encoding beats the setting, any iconv name; an unknown one is utf-8", async () => {
        await start({ "files.encoding": "utf16le" });
        expect(await decode(CP1252, { encoding: "cp1252" })).toEqual({ text: "Hellö Wörld" });
        expect(await decode(HELLO_UTF8, { encoding: "foobar123" })).toEqual({ text: "Hellö" });
        // An explicit encoding is no reason to read binary content.
        expect(await decode([0, 0, 0, 0], { encoding: "utf8" })).toMatchObject({ error: expect.any(String) });
    });

    it.each([
        ["nothing set: utf-8", {}, "Hell� W�rld"],
        ["files.autoGuessEncoding", { "files.autoGuessEncoding": true }, "Hellö Wörld"],
        ["files.encoding, an iconv name outside the enum", { "files.encoding": "cp1252" }, "Hellö Wörld"],
    ])("[api:workspace.decode] %s", async (_name, configuration, text) => {
        await start(configuration);
        expect(await decode(CP1252, inFolder("a.txt"))).toEqual({ text });
        // Without a uri the settings apply too.
        expect(await decode(CP1252)).toEqual({ text });
    });

    it("[api:workspace.decode] settings in .vscode/, .diode/, the user data directory and *.code-workspace are utf-8", async () => {
        await start({ "files.encoding": "windows1252" });
        for (const file of [
            inFolder(".vscode", "settings.json"),
            inFolder(".diode", "settings.json"),
            { path: path.join(userDir, "profiles", "work", "settings.json") },
            { path: path.join(os.tmpdir(), "elsewhere", "web.code-workspace") },
        ]) {
            expect(await decode(HELLO_UTF8, file), file.path).toEqual({ text: "Hellö" });
        }
        expect(await decode(HELLO_UTF8, inFolder(".vscodex", "a.json"))).toEqual({ text: "HellÃ¶" });
    });

    it("[api:workspace.encode] utf-8 is a Node Buffer; BOMs for utf8bom and both UTF-16; any iconv name", async () => {
        await start();
        expect(await encode("Hellö")).toEqual({ bytes: HELLO_UTF8, isBuffer: true, asString: "Hellö" });
        expect((await encode("Hi", { encoding: "utf8bom" })).bytes).toEqual([0xef, 0xbb, 0xbf, 72, 105]);
        expect((await encode("Hello", { encoding: "utf16le" })).bytes).toEqual([0xff, 0xfe, ...HELLO_UTF16LE]);
        expect(await encode("Hello", { encoding: "utf16be" })).toMatchObject({
            bytes: [0xfe, 0xff, ...HELLO_UTF16BE],
            isBuffer: true,
        });
        expect((await encode("Hellö Wörld", { encoding: "cp1252" })).bytes).toEqual(CP1252);
        expect((await encode("Hellö", { encoding: "foobar123" })).bytes).toEqual(HELLO_UTF8);
    });

    it("[api:workspace.encode] files.encoding applies by uri and without one, but not to settings files", async () => {
        await start({ "files.encoding": "utf16le" });
        expect((await encode("Hello", inFolder("a.txt"))).bytes).toEqual([0xff, 0xfe, ...HELLO_UTF16LE]);
        expect((await encode("Hello")).bytes).toEqual([0xff, 0xfe, ...HELLO_UTF16LE]);
        expect((await encode("Hello", inFolder(".vscode", "tasks.json"))).bytes).toEqual([...Buffer.from("Hello")]);
    });

    it("[api:workspace.decode] [api:workspace.encode] a language section of files.encoding applies by the uri's language", async () => {
        await start({ "[plaintext]": { "files.encoding": "cp1252" } });
        expect(await decode(CP1252, inFolder("a.txt"))).toEqual({ text: "Hellö Wörld" });
        expect((await encode("Hellö Wörld", inFolder("a.txt"))).bytes).toEqual(CP1252);
        expect((await encode("Hellö", inFolder("a.md"))).bytes).toEqual(HELLO_UTF8);
    });
});
