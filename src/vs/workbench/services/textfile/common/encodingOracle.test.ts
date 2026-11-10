import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";

import {
    BINARY_CONTENT_MESSAGE,
    decodeForResource,
    defaultUtf8Directories,
    encodeForResource,
    type IEncodingContext,
} from "./encodingOracle.ts";

/** "Hellö" in windows-1252. */
const CP1252 = Buffer.from([72, 101, 108, 108, 0xf6]);
const UTF8 = Buffer.from("Hellö");
const UTF8_BOM = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), UTF8]);
const FOLDER = path.resolve("/work/project");

function context(settings: Record<string, unknown> = {}, file?: string): IEncodingContext {
    return {
        resource: file === undefined ? undefined : Uri.file(file),
        utf8Directories: defaultUtf8Directories(path.resolve("/home/u/User"), [FOLDER]),
        setting: (key) => settings[key],
    };
}

const bytes = async (promise: Promise<Buffer>): Promise<number[]> => [...(await promise)];

describe("defaultUtf8Directories", () => {
    it("the user data directory, then .vscode/ and .diode/ of every folder", () => {
        expect(defaultUtf8Directories("/u", ["/a", "/b"])).toEqual([
            "/u",
            path.join("/a", ".vscode"),
            path.join("/a", ".diode"),
            path.join("/b", ".vscode"),
            path.join("/b", ".diode"),
        ]);
        expect(defaultUtf8Directories(undefined, [])).toEqual([]);
    });
});

describe("decodeForResource — upstream getPreferredReadEncoding", () => {
    it("nothing set: utf-8", async () => {
        expect(await decodeForResource(UTF8, context(), undefined)).toBe("Hellö");
    });

    it("files.encoding applies; an empty or non-string value is utf-8", async () => {
        expect(await decodeForResource(CP1252, context({ "files.encoding": "cp1252" }), undefined)).toBe("Hellö");
        expect(await decodeForResource(UTF8, context({ "files.encoding": "" }), undefined)).toBe("Hellö");
        expect(await decodeForResource(UTF8, context({ "files.encoding": 42 }), undefined)).toBe("Hellö");
    });

    it("the explicit encoding beats the setting and the detected UTF-16", async () => {
        const settings = context({ "files.encoding": "utf16le" });
        expect(await decodeForResource(CP1252, settings, "windows1252")).toBe("Hellö");
        const utf16 = Buffer.from("Hi", "utf16le");
        expect(await decodeForResource(utf16, context(), "latin1")).toBe("H\u0000i\u0000");
    });

    it("the detected encoding beats the setting", async () => {
        const settings = context({ "files.encoding": "windows1252" });
        expect(await decodeForResource(UTF8_BOM, settings, undefined)).toBe("Hellö");
        expect(await decodeForResource(Buffer.from("Hi", "utf16le"), settings, undefined)).toBe("Hi");
    });

    it("explicit utf8 on content with a BOM reads as utf8bom; another explicit encoding keeps the BOM as text", async () => {
        expect(await decodeForResource(UTF8_BOM, context(), "utf8")).toBe("Hellö");
        expect(await decodeForResource(UTF8_BOM, context(), "windows1252")).toBe("ï»¿HellÃ¶");
    });

    it("files.encoding utf8bom without a BOM reads as utf-8", async () => {
        expect(await decodeForResource(UTF8, context({ "files.encoding": "utf8bom" }), undefined)).toBe("Hellö");
    });

    it("an unknown name, explicit or configured, is utf-8 rather than the setting", async () => {
        expect(await decodeForResource(UTF8, context({ "files.encoding": "cp1252" }), "foobar123")).toBe("Hellö");
        expect(await decodeForResource(UTF8, context({ "files.encoding": "foobar123" }), undefined)).toBe("Hellö");
    });

    it("files.autoGuessEncoding guesses only when it is true; candidates are read from the setting", async () => {
        const text = Buffer.from("Hellö Wörld, schön", "latin1");
        expect(await decodeForResource(text, context({ "files.autoGuessEncoding": "yes" }), undefined)).not.toBe(
            "Hellö Wörld, schön",
        );
        expect(await decodeForResource(text, context({ "files.autoGuessEncoding": true }), undefined)).toBe(
            "Hellö Wörld, schön",
        );
        const narrowed = context({
            "files.autoGuessEncoding": true,
            "files.candidateGuessEncodings": ["windows1252", 7],
        });
        expect(await decodeForResource(text, narrowed, undefined)).toBe("Hellö Wörld, schön");
        // A non-array value is no candidates, not a crash.
        const garbage = context({ "files.autoGuessEncoding": true, "files.candidateGuessEncodings": "windows1252" });
        expect(await decodeForResource(text, garbage, undefined)).toBe("Hellö Wörld, schön");
    });

    it("files.candidateGuessEncodings narrows the guess: Cyrillic bytes read as windows-1252", async () => {
        // "Privet, mir" in Cyrillic, windows-1251.
        const cp1251 = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x2c, 0x20, 0xec, 0xe8, 0xf0]);
        const guess = (candidates: unknown) =>
            decodeForResource(
                cp1251,
                context({ "files.autoGuessEncoding": true, "files.candidateGuessEncodings": candidates }),
                undefined,
            );
        expect(await guess([])).toBe("\u041f\u0440\u0438\u0432\u0435\u0442, \u043c\u0438\u0440");
        expect(await guess(["windows1252", 7])).toBe(cp1251.toString("latin1"));
    });

    it("binary content throws upstream's message, with or without an explicit encoding", async () => {
        const binary = Buffer.from([0, 0, 0, 0]);
        await expect(decodeForResource(binary, context(), undefined)).rejects.toThrow(BINARY_CONTENT_MESSAGE);
        await expect(decodeForResource(binary, context(), "utf8")).rejects.toThrow(BINARY_CONTENT_MESSAGE);
    });

    it("settings files are utf-8 whatever the setting, the explicit and the detected encoding say", async () => {
        const settings = { "files.encoding": "windows1252" };
        for (const file of [
            path.join(FOLDER, ".vscode", "settings.json"),
            path.join(FOLDER, ".diode", "tasks.json"),
            path.resolve("/home/u/User"),
            path.resolve("/home/u/User/profiles/p/settings.json"),
            path.resolve("/anywhere/web.code-workspace"),
        ]) {
            expect(await decodeForResource(UTF8, context(settings, file), "windows1252"), file).toBe("Hellö");
        }
        expect(
            await decodeForResource(
                Buffer.from("Hi", "utf16le"),
                context(settings, path.join(FOLDER, ".vscode", "a")),
                undefined,
            ),
        ).toBe("H\u0000i\u0000");
    });

    it("outside the overrides the setting applies: a sibling with the same prefix is not inside", async () => {
        const settings = { "files.encoding": "windows1252" };
        for (const file of [
            path.join(FOLDER, ".vscodex", "a.json"),
            path.resolve("/home/u/Users/a.json"),
            path.join(FOLDER, "a.code-workspace.txt"),
        ]) {
            expect(await decodeForResource(CP1252, context(settings, file), undefined), file).toBe("Hellö");
        }
    });

    it("a directory given with a trailing separator still matches", async () => {
        const trailing: IEncodingContext = {
            resource: Uri.file(path.resolve("/data/x.json")),
            utf8Directories: [path.resolve("/data") + path.sep],
            setting: () => "windows1252",
        };
        expect(await decodeForResource(UTF8, trailing, undefined)).toBe("Hellö");
    });

    it("parent overrides are file paths: another scheme is not inside them, the workspace extension is", async () => {
        const settings = { "files.encoding": "windows1252" };
        const other = (uri: Uri): IEncodingContext => ({ ...context(settings), resource: uri });
        const inside = Uri.file(path.join(FOLDER, ".vscode", "a.json")).with({ scheme: "git" });
        expect(await decodeForResource(CP1252, other(inside), undefined)).toBe("Hellö");
        const workspace = Uri.from({ scheme: "git", path: "/x/web.code-workspace" });
        expect(await decodeForResource(UTF8, other(workspace), undefined)).toBe("Hellö");
    });
});

describe("encodeForResource — upstream getWriteEncoding", () => {
    it("the explicit encoding, then the setting, then utf-8; BOMs only for utf8bom and both UTF-16", async () => {
        expect(await bytes(encodeForResource("Hi", context(), undefined))).toEqual([0x48, 0x69]);
        expect(await bytes(encodeForResource("Hi", context({ "files.encoding": "utf8bom" }), undefined))).toEqual([
            0xef, 0xbb, 0xbf, 0x48, 0x69,
        ]);
        expect(await bytes(encodeForResource("H", context({ "files.encoding": "utf8bom" }), "utf16be"))).toEqual([
            0xfe, 0xff, 0x00, 0x48,
        ]);
        expect(await encodeForResource("Hellö", context(), "cp1252")).toEqual(CP1252);
        expect(await bytes(encodeForResource("Hi", context({ "files.encoding": "cp1252" }), "nope"))).toEqual([
            0x48, 0x69,
        ]);
    });

    it("settings files are written utf-8 without a BOM", async () => {
        const file = path.join(FOLDER, ".vscode", "settings.json");
        expect(await bytes(encodeForResource("Hi", context({ "files.encoding": "utf16le" }, file), "utf8bom"))).toEqual(
            [0x48, 0x69],
        );
    });
});
