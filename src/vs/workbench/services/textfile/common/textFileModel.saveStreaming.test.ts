import { createHash } from "node:crypto";
import * as fs from "node:fs";

import iconv from "iconv-lite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import type { FileWriteContent } from "../../../../platform/files/common/files.ts";

import type { TextFileModel } from "./textFileModel.ts";

// QA of PR #803 (OpenPerformance 4.5): a save streams the snapshot to disk a megabyte at a time, across awaits, and
// the user keeps working meanwhile. Whatever they do, the file on disk must be the text at the moment of Ctrl+S.

/** ~6 MiB of numbered lines: the encoded snapshot goes to disk in several pieces. */
function bigText(eol = "\n"): string {
    return Array.from({ length: 80_000 }, (_, i) => `${String(i)} INFO worker request handled path=/api/v1/items`).join(
        eol,
    );
}

function sha(bytes: Buffer | string): string {
    return createHash("sha256").update(bytes).digest("hex");
}

describe("TextFileModel — the user works while a save streams to disk", () => {
    let ws: ITempWorkspace;
    let pane: TextEditorPane<TextFileModel>;
    /** Runs once, after the first piece of the stream has reached the provider: the write is under way. */
    let midWrite: () => void;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-save-stream-" });
        midWrite = () => undefined;
        const files = diskFileService();
        const write = files.writeFile.bind(files);
        files.writeFile = (resource, value, options) => write(resource, pausedAfterFirst(value), options);
        pane = createEditorPane({ files });
    });

    afterEach(() => {
        pane.dispose();
        ws.dispose();
    });

    function pausedAfterFirst(value: FileWriteContent): FileWriteContent {
        if (value instanceof Uint8Array) return value;
        return (async function* () {
            let first = true;
            for await (const piece of value) {
                yield piece;
                if (first) {
                    first = false;
                    midWrite();
                }
            }
        })();
    }

    function openEdited(eol = "\n"): { path: string; expected: string } {
        const path = ws.writeFile("big.log", bigText(eol));
        pane.openFile(Uri.file(path));
        const doc = pane.model.document;
        // Edits at the start, in the middle and at the end: the snapshot is a tree of many pieces.
        doc.applyEdits([
            { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "HEAD " },
        ]);
        doc.applyEdits([
            { range: { start: { line: 40_000, character: 0 }, end: { line: 40_000, character: 5 } }, text: "MID" },
        ]);
        const last = doc.lineCount - 1;
        const end = doc.getLineContent(last).length;
        doc.applyEdits([
            { range: { start: { line: last, character: end }, end: { line: last, character: end } }, text: " TAIL" },
        ]);
        return { path, expected: doc.serialize() };
    }

    it("control: nothing happens during the write, the file is the text byte for byte", async () => {
        const { path, expected } = openEdited();

        expect(await pane.model.save()).toBe("saved");

        expect(sha(fs.readFileSync(path))).toBe(sha(expected));
        expect(pane.model.isModified).toBe(false);
    });

    it("typing and deleting during the write: the file is the text at Ctrl+S, the buffer stays modified", async () => {
        const { path, expected } = openEdited();
        midWrite = () => {
            const doc = pane.model.document;
            doc.applyEdits([
                { range: { start: { line: 10, character: 0 }, end: { line: 70_000, character: 0 } }, text: "" },
            ]);
            doc.applyEdits([
                { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "late " },
            ]);
        };

        expect(await pane.model.save()).toBe("saved");

        expect(sha(fs.readFileSync(path))).toBe(sha(expected));
        expect(pane.model.isModified).toBe(true);
    });

    it("the EOL switched to CRLF in the status bar during the write: the file keeps the LF text of Ctrl+S", async () => {
        const { path, expected } = openEdited();
        midWrite = () => {
            pane.model.setEol(EndOfLine.CRLF);
        };

        expect(await pane.model.save()).toBe("saved");

        const onDisk = fs.readFileSync(path);
        expect(onDisk.length).toBe(Buffer.byteLength(expected));
        expect(sha(onDisk)).toBe(sha(expected));
        // The CRLF switch is not in the file: the buffer is modified.
        expect(pane.model.isModified).toBe(true);
    });

    it("a CRLF file with a BOM: the save keeps both", async () => {
        const path = ws.writeFile("crlf.log", "");
        fs.writeFileSync(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(bigText("\r\n"))]));
        pane.openFile(Uri.file(path));
        pane.model.document.applyEdits([
            { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } }, text: "x" },
        ]);

        expect(await pane.model.save()).toBe("saved");

        const lines = bigText("\r\n").split("\r\n");
        lines[1] = `x${lines[1]}`;
        const expected = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(lines.join("\r\n"))]);
        expect(sha(fs.readFileSync(path))).toBe(sha(expected));
    });

    it.each([
        ["utf16le", (text: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")])],
        ["windows1251", (text: string) => iconv.encode(text, "windows-1251")],
    ])("a save in %s streams the whole text in that encoding", async (encoding, encode) => {
        // "\u043f\u0440\u0438\u0432\u0435\u0442": a word every single-byte Cyrillic code page holds.
        const word = "\u043f\u0440\u0438\u0432\u0435\u0442";
        const text = Array.from({ length: 60_000 }, (_, i) => `${String(i)} ${word} INFO worker request handled`).join(
            "\n",
        );
        const path = ws.writeFile("enc.log", text);
        pane.openFile(Uri.file(path));

        expect(await pane.model.saveWithEncoding(encoding)).toBe("saved");

        expect(sha(fs.readFileSync(path))).toBe(sha(encode(text)));
    });

    it("no write permission on the folder: the save fails, the file on disk is untouched, no temp file is left", async () => {
        const { path } = openEdited();
        const before = sha(fs.readFileSync(path));
        fs.chmodSync(ws.dir, 0o555);
        try {
            await expect(pane.model.save()).rejects.toThrow();
        } finally {
            fs.chmodSync(ws.dir, 0o755);
        }

        expect(sha(fs.readFileSync(path))).toBe(before);
        expect(fs.readdirSync(ws.dir)).toEqual(["big.log"]);
        expect(pane.model.isModified).toBe(true);
    });
});
