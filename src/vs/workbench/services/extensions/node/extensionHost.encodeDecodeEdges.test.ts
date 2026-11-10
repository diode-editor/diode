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

const FIXTURE = extensionFixture("test.encodingProbe", "encodingProbe.cjs");

const TXT_IS_PLAINTEXT: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".txt") ? "plaintext" : undefined),
};

/** "Hellö Wörld" in windows-1252. */
const CP1252 = [72, 101, 108, 108, 0xf6, 32, 87, 0xf6, 114, 108, 100];
const RUSSIAN = "Привет, мир! Как у тебя дела сегодня? Всё хорошо, спасибо большое.";

interface IProbeResult {
    readonly value?: unknown;
    readonly error?: string;
}

describe("ExtensionHost — workspace.decode / workspace.encode edge cases (subprocess)", () => {
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

    /** Runs `source` as an async function body in the extension, `vscode` in scope. */
    const run = (source: string): Promise<IProbeResult> => {
        if (harness === undefined) throw new Error("start() first");
        return harness.commandRegistry.execute("test.encodingProbe.run", source) as Promise<IProbeResult>;
    };
    const bytesOf = (call: string): Promise<IProbeResult> => run(`return Array.from(await ${call});`);
    const fileUri = (...segments: string[]): string =>
        `vscode.Uri.file(${JSON.stringify(path.join(dir, ...segments))})`;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-encode-decode-edges-"));
        userDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-encode-decode-edges-user-"));
    });

    afterEach(async () => {
        await harness?.dispose();
        harness = undefined;
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(userDir, { recursive: true, force: true });
    });

    it("[api:workspace.decode] [api:workspace.encode] empty content", async () => {
        await start();
        expect(await run("return await vscode.workspace.decode(new Uint8Array(0));")).toEqual({ value: "" });
        expect(
            await run("const b = await vscode.workspace.encode(''); return [Buffer.isBuffer(b), b.length];"),
        ).toEqual({ value: [true, 0] });
        // Upstream's toEncodeReadable writes the BOM alone when there is no text.
        expect(await bytesOf("vscode.workspace.encode('', { encoding: 'utf8bom' })")).toEqual({
            value: [0xef, 0xbb, 0xbf],
        });
        expect(await bytesOf("vscode.workspace.encode('', { encoding: 'utf16le' })")).toEqual({ value: [0xff, 0xfe] });
        expect(await bytesOf("vscode.workspace.encode('', { encoding: 'utf16be' })")).toEqual({ value: [0xfe, 0xff] });
    });

    it("[api:workspace.encode] a BOM only for exactly utf8bom/utf16le/utf16be; other spellings are kept verbatim", async () => {
        await start();
        expect(await bytesOf("vscode.workspace.encode('Hi', { encoding: 'UTF16LE' })")).toEqual({
            value: [72, 0, 105, 0],
        });
        expect(await bytesOf("vscode.workspace.encode('Hi', { encoding: 'utf-16le' })")).toEqual({
            value: [72, 0, 105, 0],
        });
        expect(await bytesOf("vscode.workspace.encode('Hi', { encoding: 'utf-16be' })")).toEqual({
            value: [0, 72, 0, 105],
        });
        expect(await bytesOf("vscode.workspace.encode('ö', { encoding: 'Windows-1252' })")).toEqual({ value: [0xf6] });
        expect(await bytesOf("vscode.workspace.encode('ö', { encoding: 'latin1' })")).toEqual({ value: [0xf6] });
        expect(await bytesOf("vscode.workspace.encode('ö', { encoding: 'UTF-8' })")).toEqual({ value: [0xc3, 0xb6] });
    });

    it("[api:workspace.decode] other spellings of iconv names decode", async () => {
        await start();
        expect(
            await run("return await vscode.workspace.decode(new Uint8Array([0xf6]), { encoding: 'Windows-1252' });"),
        ).toEqual({ value: "ö" });
        expect(
            await run("return await vscode.workspace.decode(new Uint8Array([0xc3, 0xb6]), { encoding: 'UTF-8' });"),
        ).toEqual({ value: "ö" });
        expect(
            await run(
                "return await vscode.workspace.decode(new Uint8Array([72, 0, 105, 0]), { encoding: 'UTF-16LE' });",
            ),
        ).toEqual({ value: "Hi" });
    });

    it("[api:workspace.decode] decodes only the bytes of a Uint8Array view, not its whole ArrayBuffer", async () => {
        await start();
        expect(
            await run(
                "const all = new Uint8Array([0, 0, 0xff, 72, 105, 0xff, 0, 0]); return await vscode.workspace.decode(all.subarray(3, 5));",
            ),
        ).toEqual({ value: "Hi" });
        expect(await run("return await vscode.workspace.decode(Buffer.from('xxHi').subarray(2));")).toEqual({
            value: "Hi",
        });
    });

    it("[api:workspace.decode] zero bytes: only the first 512 bytes decide", async () => {
        await start();
        expect(
            await run(
                "const b = new Uint8Array(601).fill(97); b[600] = 0; const t = await vscode.workspace.decode(b); return [t.length, t.charCodeAt(600)];",
            ),
        ).toEqual({ value: [601, 0] });
        expect(await run("return await vscode.workspace.decode(new Uint8Array([97, 98, 0]));")).toEqual({
            error: "Stream is binary but only text is accepted for decoding",
        });
        expect(await run("return await vscode.workspace.decode(new Uint8Array([65, 0]));")).toEqual({ value: "A" });
    });

    it("[api:workspace.decode] an explicit encoding beats a BOM, except utf8 on a UTF-8 BOM", async () => {
        await start();
        const bomHi = "new Uint8Array([0xef, 0xbb, 0xbf, 72, 105])";
        expect(await run(`return await vscode.workspace.decode(${bomHi}, { encoding: 'utf8' });`)).toEqual({
            value: "Hi",
        });
        expect(await run(`return await vscode.workspace.decode(${bomHi}, { encoding: 'cp1252' });`)).toEqual({
            value: "ï»¿Hi",
        });
        expect(
            await run("return await vscode.workspace.decode(new Uint8Array([72, 105]), { encoding: 'utf8bom' });"),
        ).toEqual({ value: "Hi" });
        expect(
            await run(
                "return await vscode.workspace.decode(new Uint8Array([0xff, 0xfe, 72, 0]), { encoding: 'utf16le' });",
            ),
        ).toEqual({ value: "H" });
    });

    it("[api:workspace.decode] [api:workspace.encode] astral characters round-trip through UTF-16", async () => {
        await start();
        for (const encoding of ["utf16le", "utf16be", "utf8bom", "utf8"]) {
            expect(
                await run(
                    `const b = await vscode.workspace.encode('a😀ж', { encoding: '${encoding}' }); return await vscode.workspace.decode(b);`,
                ),
                encoding,
            ).toEqual({ value: "a😀ж" });
        }
        expect(await bytesOf("vscode.workspace.encode('\\ud800')")).toEqual({ value: [0xef, 0xbf, 0xbd] });
    });

    it("[api:workspace.decode] [api:workspace.encode] many calls at once", async () => {
        await start({ "files.autoGuessEncoding": true });
        expect(
            await run(`
                const cp = new Uint8Array(${JSON.stringify(CP1252)});
                const all = await Promise.all([
                    ...Array.from({ length: 10 }, () => vscode.workspace.decode(cp)),
                    ...Array.from({ length: 10 }, () => vscode.workspace.decode(cp, { encoding: 'cp1252' })),
                    ...Array.from({ length: 10 }, async () => Array.from(await vscode.workspace.encode('Hellö Wörld', { encoding: 'cp1252' })).join(',')),
                ]);
                return [...new Set(all)];`),
        ).toEqual({ value: ["Hellö Wörld", CP1252.join(",")] });
    });

    it("[api:workspace.decode] guessing: Cyrillic code pages, as upstream's jschardet mapping", async () => {
        await start({ "files.autoGuessEncoding": true });
        for (const [label, encoding] of [
            ["windows1251", "windows1251"],
            ["koi8r", "koi8-r"],
            ["cp866", "cp866"],
        ] as const) {
            const bytes = await run(
                `return Array.from(await vscode.workspace.encode(${JSON.stringify(RUSSIAN)}, { encoding: '${encoding}' }));`,
            );
            expect(
                await run(`return await vscode.workspace.decode(new Uint8Array(${JSON.stringify(bytes.value)}));`),
                label,
            ).toEqual({ value: RUSSIAN });
        }
    });

    it("[api:workspace.decode] guessing looks at the first 64 KB only (upstream's jschardet limit)", async () => {
        await start({ "files.autoGuessEncoding": true });
        // 70000 ASCII bytes, then cp1252: jschardet sees ASCII, ignored → utf-8.
        expect(
            await run(`
                const b = new Uint8Array(70000 + ${CP1252.length}).fill(97);
                b.set(${JSON.stringify(CP1252)}, 70000);
                return (await vscode.workspace.decode(b)).slice(70000);`),
        ).toEqual({ value: "Hell� W�rld" });
    });

    it("[api:workspace.decode] guessing: candidateGuessEncodings limits the guess; settings files stay utf-8", async () => {
        await start({ "files.autoGuessEncoding": true, "files.candidateGuessEncodings": ["koi8r"] });
        const cp1251 = await run(
            `return Array.from(await vscode.workspace.encode(${JSON.stringify(RUSSIAN)}, { encoding: 'windows1251' }));`,
        );
        const decoded = await run(
            `return await vscode.workspace.decode(new Uint8Array(${JSON.stringify(cp1251.value)}));`,
        );
        expect(decoded.value).not.toBe(RUSSIAN);
        expect(
            await run(
                `return await vscode.workspace.decode(new Uint8Array(${JSON.stringify(CP1252)}), { uri: ${fileUri(".vscode", "settings.json")} });`,
            ),
        ).toEqual({ value: "Hell� W�rld" });
    });

    it("[api:workspace.decode] [api:workspace.encode] files.encoding utf8bom: encode writes a BOM, decode reads text without one", async () => {
        await start({ "files.encoding": "utf8bom" });
        expect(await bytesOf("vscode.workspace.encode('Hi')")).toEqual({ value: [0xef, 0xbb, 0xbf, 72, 105] });
        expect(await bytesOf(`vscode.workspace.encode('Hi', { uri: ${fileUri("a.txt")} })`)).toEqual({
            value: [0xef, 0xbb, 0xbf, 72, 105],
        });
        expect(await run("return await vscode.workspace.decode(new Uint8Array([72, 0xc3, 0xb6]));")).toEqual({
            value: "Hö",
        });
    });

    it("[api:workspace.decode] an untitled uri gets files.encoding", async () => {
        await start({ "files.encoding": "cp1252" });
        expect(
            await run(
                `return await vscode.workspace.decode(new Uint8Array(${JSON.stringify(CP1252)}), { uri: vscode.Uri.parse('untitled:Untitled-1') });`,
            ),
        ).toEqual({ value: "Hellö Wörld" });
    });

    it("[api:workspace.decode] [api:workspace.encode] the settings-file override beats an explicit encoding given with a uri", async () => {
        await start();
        const settings = fileUri(".vscode", "settings.json");
        expect(
            await run(
                `return await vscode.workspace.decode(new Uint8Array([72, 0xc3, 0xb6]), { uri: ${settings}, encoding: 'cp1252' });`,
            ),
        ).toEqual({ value: "Hö" });
        expect(await bytesOf(`vscode.workspace.encode('Hö', { uri: ${settings}, encoding: 'utf16le' })`)).toEqual({
            value: [72, 0xc3, 0xb6],
        });
    });

    it("[api:workspace.decode] an explicit encoding beats the UTF-16 zero-byte pattern", async () => {
        await start();
        expect(
            await run("return await vscode.workspace.decode(new Uint8Array([72, 0, 105, 0]), { encoding: 'cp1252' });"),
        ).toEqual({ value: "H\0i\0" });
    });

    it.each([
        ["an unknown name is utf-8", "foobar123", [72, 105]],
        ["another spelling of utf16le gets no BOM", "UTF16LE", [72, 0, 105, 0]],
    ])("[api:workspace.encode] files.encoding: %s", async (_name, encoding, bytes) => {
        await start({ "files.encoding": encoding });
        expect(await bytesOf(`vscode.workspace.encode('Hi', { uri: ${fileUri("a.txt")} })`)).toEqual({ value: bytes });
    });
});
