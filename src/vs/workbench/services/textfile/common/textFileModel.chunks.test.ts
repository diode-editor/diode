import * as fs from "node:fs";

import iconv from "iconv-lite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import { encodeText } from "../../../../editor/common/model/encoding.ts";

import { READ_CHUNK_SIZE } from "./textFileModel.ts";

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
 * A chunk boundary splits `\r\n`, multibyte utf-8, a surrogate pair and a UTF-16 byte pair:
 * opening and saving without edits must return the file byte for byte (A4, docs/TODO/VscodeModel.md).
 */
const CHUNK = READ_CHUNK_SIZE;

describe("TextFileModel — chunked read and snapshot write", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-textfile-chunks-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    /**
     * Text whose chunk boundary (byte `CHUNK` in the chosen encoding, BOM included)
     * splits `tail`: it starts `bytesBeforeBoundary` bytes before the boundary.
     */
    async function straddling(encoding: string, tail: string, bytesBeforeBoundary: number): Promise<string> {
        const bomLength = (await encodeText("", encoding)).length;
        const unit = (await encodeText("a", encoding)).length - bomLength;
        const fill = (CHUNK - bomLength - bytesBeforeBoundary) / unit;
        // Lines of 63 chars + EOL, the remainder as one line before the tail.
        const lines = "a".repeat(62) + "\r\n";
        const body = lines.repeat(Math.floor(fill / lines.length)) + "b".repeat(fill % lines.length);
        expect((await encodeText(body, encoding)).length).toBe(CHUNK - bytesBeforeBoundary);
        return `${body}${tail}\r\nend\r\n`;
    }

    const CASES: { name: string; encoding: string; tail: string; before: number }[] = [
        { name: "\\r | \\n", encoding: "utf8", tail: "\r\n", before: 1 },
        { name: "Cyrillic in the middle", encoding: "utf8", tail: "\u0436", before: 1 }, // "zh"
        { name: "emoji, 1 of 4 bytes", encoding: "utf8", tail: "😀", before: 1 },
        { name: "emoji, 3 of 4 bytes", encoding: "utf8", tail: "😀", before: 3 },
        { name: "utf8bom: emoji, 2 of 4 bytes", encoding: "utf8bom", tail: "😀", before: 2 },
        { name: "UTF-16 LE: surrogate pair", encoding: "utf16le", tail: "😀", before: 2 },
        { name: "UTF-16 LE: \\r | \\n", encoding: "utf16le", tail: "\r\n", before: 2 },
        { name: "UTF-16 BE: surrogate pair", encoding: "utf16be", tail: "𝄞", before: 2 },
    ];

    for (const { name, encoding, tail, before } of CASES) {
        it(`${name}: open equals the file text, save is byte for byte`, async () => {
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

            // `save` writes a clean buffer too.
            fs.rmSync(filePath);
            await pane.save();
            expect(fs.readFileSync(filePath).equals(bytes)).toBe(true);
            pane.dispose();
        });
    }

    it("the file is closed both after open and after a stale reopen", async () => {
        const filePath = ws.path("fd.txt");
        fs.writeFileSync(filePath, iconv.encode("text\n", "windows1251"));
        const pane = createEditorPane();
        pane.openFile(Uri.file(filePath));
        expect(openPaths()).not.toContain(filePath);

        // Reopen waits for iconv and a reload overtakes it: the read it started is still closed.
        const pending = pane.reopenWithEncoding("windows1251");
        pane.revertToDisk();
        expect(await pending).toBe(false);
        expect(openPaths()).not.toContain(filePath);
        pane.dispose();
    });

    it("an empty or missing file gives an empty document", () => {
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
