import * as fs from "node:fs";

import iconv from "iconv-lite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import { encodeText } from "../../../../editor/common/model/encoding.ts";

import { READ_CHUNK_SIZE } from "./textFileModel.ts";

/** Открытые через `fs.openSync` дескрипторы → путь: чтение кусками обязано их закрывать. */
const openFds = vi.hoisted(() => new Map<number, string>());

vi.mock("node:fs", async (importActual) => {
    const actual = await importActual<typeof fs>();
    return {
        ...actual,
        openSync: (...args: Parameters<typeof actual.openSync>) => {
            const fd = actual.openSync(...args);
            openFds.set(fd, String(args[0]));
            return fd;
        },
        closeSync: (fd: number) => {
            openFds.delete(fd);
            actual.closeSync(fd);
        },
    };
});

function openPaths(): string[] {
    return [...openFds.values()];
}

/**
 * Файл читается кусками ({@link READ_CHUNK_SIZE}) и пишется снимком документа (A4,
 * docs/TODO/VscodeModel.md). Граница куска в настоящем файле режет `\r\n`,
 * многобайтовый символ utf-8, суррогатную пару и пару байт UTF-16 — открытие и
 * сохранение без правок обязаны вернуть файл байт в байт.
 */
const CHUNK = READ_CHUNK_SIZE;

describe("TextFileModel — чтение кусками и запись снимком", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-textfile-chunks-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    /**
     * Текст, у которого граница куска (байт `CHUNK` в выбранной кодировке, с
     * BOM) режет `tail`: он начинается за `bytesBeforeBoundary` байт до неё.
     */
    async function straddling(encoding: string, tail: string, bytesBeforeBoundary: number): Promise<string> {
        const bomLength = (await encodeText("", encoding)).length;
        const unit = (await encodeText("a", encoding)).length - bomLength;
        const fill = (CHUNK - bomLength - bytesBeforeBoundary) / unit;
        // Строки по 63 символа + EOL, остаток — одной строкой перед хвостом.
        const lines = "a".repeat(62) + "\r\n";
        const body = lines.repeat(Math.floor(fill / lines.length)) + "b".repeat(fill % lines.length);
        // Хвост и правда стоит на границе: до него ровно `CHUNK - before` байт.
        expect((await encodeText(body, encoding)).length).toBe(CHUNK - bytesBeforeBoundary);
        return `${body}${tail}\r\nend\r\n`;
    }

    const CASES: { name: string; encoding: string; tail: string; before: number }[] = [
        { name: "\\r | \\n", encoding: "utf8", tail: "\r\n", before: 1 },
        { name: "кириллица посреди", encoding: "utf8", tail: "ж", before: 1 },
        { name: "эмодзи, 1 из 4 байт", encoding: "utf8", tail: "😀", before: 1 },
        { name: "эмодзи, 3 из 4 байт", encoding: "utf8", tail: "😀", before: 3 },
        { name: "utf8bom: эмодзи, 2 из 4 байт", encoding: "utf8bom", tail: "😀", before: 2 },
        { name: "UTF-16 LE: суррогатная пара", encoding: "utf16le", tail: "😀", before: 2 },
        { name: "UTF-16 LE: \\r | \\n", encoding: "utf16le", tail: "\r\n", before: 2 },
        { name: "UTF-16 BE: суррогатная пара", encoding: "utf16be", tail: "𝄞", before: 2 },
    ];

    for (const { name, encoding, tail, before } of CASES) {
        it(`${name}: открытие == тексту файла, сохранение — байт в байт`, async () => {
            const text = await straddling(encoding, tail, before);
            const bytes = await encodeText(text, encoding);
            expect(bytes.length).toBeGreaterThan(CHUNK);
            const filePath = ws.path(`${encoding}.txt`);
            fs.writeFileSync(filePath, bytes);

            const pane = createEditorPane();
            pane.openFile(Uri.file(filePath));
            expect(pane.encoding).toBe(encoding);
            expect(pane.model.eol).toBe(EndOfLine.CRLF);
            expect(pane.getText()).toBe(text.replace(/\r\n/g, "\n"));

            // Сохранение без правок (`save` пишет и чистый буфер) — тот же файл.
            fs.rmSync(filePath);
            await pane.save();
            expect(fs.readFileSync(filePath).equals(bytes)).toBe(true);
            pane.dispose();
        });
    }

    it("файл закрывается: и после открытия, и после устаревшего reopen", async () => {
        const filePath = ws.path("fd.txt");
        fs.writeFileSync(filePath, iconv.encode("текст\n", "windows1251"));
        const pane = createEditorPane();
        pane.openFile(Uri.file(filePath));
        expect(openPaths()).not.toContain(filePath);

        // Reopen ждёт iconv, перечитка его обгоняет: начатое им чтение всё равно закрыто.
        const pending = pane.reopenWithEncoding("windows1251");
        pane.revertToDisk();
        expect(await pending).toBe(false);
        expect(openPaths()).not.toContain(filePath);
        pane.dispose();
    });

    it("пустой и отсутствующий файл — пустой документ", () => {
        const empty = ws.path("empty.txt");
        fs.writeFileSync(empty, "");
        for (const filePath of [empty, ws.path("missing.txt")]) {
            const pane = createEditorPane();
            pane.openFile(Uri.file(filePath));
            expect(pane.getText()).toBe("");
            expect(pane.model.document.lineCount).toBe(1);
            pane.dispose();
        }
    });
});
