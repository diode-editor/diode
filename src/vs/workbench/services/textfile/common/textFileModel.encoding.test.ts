import * as fs from "node:fs";

import iconv from "iconv-lite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { setLazyModuleLoader } from "../../../../base/common/lazyModule.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";

import { TextFileSaveParticipant } from "./textFileSaveParticipant.ts";

describe("TextFileModel — encoding axis", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-editorctrl-enc-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    function writeBytes(name: string, bytes: Buffer): string {
        const filePath = ws.path(name);
        fs.writeFileSync(filePath, bytes);
        return filePath;
    }

    it("new untitled buffer defaults to utf8", () => {
        const controller = createEditorPane();
        expect(controller.encoding).toBe("utf8");
        controller.dispose();
    });

    it("detects utf8bom / utf16le / utf16be by BOM on open", () => {
        const cases: [string, Buffer][] = [
            ["utf8bom", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hi", "utf8")])],
            ["utf16le", Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode("hi", "utf16le")])],
            ["utf16be", Buffer.concat([Buffer.from([0xfe, 0xff]), iconv.encode("hi", "utf16-be")])],
        ];
        for (const [expected, bytes] of cases) {
            const controller = createEditorPane();
            controller.openFile(Uri.file(writeBytes(`${expected}.txt`, bytes)));
            expect(controller.encoding).toBe(expected);
            expect(controller.getText()).toBe("hi");
            controller.dispose();
        }
    });

    it("a file without BOM is read as utf8", () => {
        const controller = createEditorPane();
        controller.openFile(
            Uri.file(writeBytes("plain.txt", Buffer.from("\u043f\u0440\u0438\u0432\u0435\u0442\n", "utf8"))),
        ); // "privet"
        expect(controller.encoding).toBe("utf8");
        expect(controller.getText()).toBe("\u043f\u0440\u0438\u0432\u0435\u0442\n"); // "privet"
        controller.dispose();
    });

    it("reopenWithEncoding rereads the file in the given encoding", async () => {
        const controller = createEditorPane();
        const fp = writeBytes(
            "cyr.txt",
            iconv.encode("\u041f\u0440\u0438\u0432\u0435\u0442, \u043c\u0438\u0440!\n", "windows1251"),
        ); // "Privet, mir!"
        controller.openFile(Uri.file(fp));
        // Decoded as utf8 it is mojibake.
        expect(controller.getText()).not.toContain("\u041f\u0440\u0438\u0432\u0435\u0442"); // "Privet"

        expect(await controller.reopenWithEncoding("windows1251")).toBe(true);
        expect(controller.encoding).toBe("windows1251");
        expect(controller.getText()).toBe("\u041f\u0440\u0438\u0432\u0435\u0442, \u043c\u0438\u0440!\n"); // "Privet, mir!"
        controller.dispose();
    });

    it("reopenWithEncoding returns false for an untitled buffer", async () => {
        const controller = createEditorPane();
        expect(await controller.reopenWithEncoding("windows1251")).toBe(false);
        controller.dispose();
    });

    // iconv-lite is a lazy chunk (encoding.ts): the seam must not fire when opening
    // and writing a regular file, otherwise the chunk loads on every run.
    it("opening, editing and writing utf-8 and UTF-16 files do not load iconv; reopen in windows-1251 does", async () => {
        const requested: string[] = [];
        setLazyModuleLoader(<T>(id: string, importer: () => Promise<T>) => {
            requested.push(id);
            return importer();
        });
        try {
            const files: [string, Buffer][] = [
                ["plain.txt", Buffer.from("\u043f\u0440\u0438\u0432\u0435\u0442\n", "utf8")], // "privet"
                [
                    "le.txt",
                    Buffer.concat([
                        Buffer.from([0xff, 0xfe]),
                        Buffer.from("\u043f\u0440\u0438\u0432\u0435\u0442\n", "utf16le"),
                    ]),
                ], // "privet"
            ];
            for (const [name, bytes] of files) {
                const controller = createEditorPane();
                controller.openFile(Uri.file(writeBytes(name, bytes)));
                controller.applyExternalEdits([createTextEdit(createRange(0, 0, 0, 0), "x")], "test edit");
                await controller.save();
                controller.revertToDisk();
                expect(controller.getText()).toBe("x\u043f\u0440\u0438\u0432\u0435\u0442\n"); // "xprivet"
                controller.dispose();
            }
            expect(requested).toEqual([]);

            const controller = createEditorPane();
            controller.openFile(Uri.file(writeBytes("cyr.txt", iconv.encode("hello\n", "windows1251"))));
            expect(requested).toEqual([]);
            await controller.reopenWithEncoding("windows1251");
            expect(requested).toEqual(["iconv-lite"]);
            controller.dispose();
        } finally {
            setLazyModuleLoader(undefined);
        }
    });

    // Decoding with an explicit encoding is async (non-Unicode waits for iconv): whatever
    // happened to the buffer meanwhile wins over the stale result.
    describe("reopenWithEncoding overtaken before decoding finishes", () => {
        it("revertToDisk: the reread wins, reopen is not applied", async () => {
            const controller = createEditorPane();
            const fp = writeBytes("race-revert.txt", iconv.encode("\u0442\u0435\u043a\u0441\u0442\n", "windows1251")); // "tekst"
            controller.openFile(Uri.file(fp));
            const asUtf8 = controller.getText();

            const pending = controller.reopenWithEncoding("windows1251");
            controller.revertToDisk();

            expect(await pending).toBe(false);
            expect(controller.encoding).toBe("utf8");
            expect(controller.getText()).toBe(asUtf8);
            controller.dispose();
        });

        it("second reopen: the last one wins", async () => {
            const controller = createEditorPane();
            const fp = writeBytes("race-twice.txt", iconv.encode("\u0442\u0435\u043a\u0441\u0442\n", "koi8r")); // "tekst"
            controller.openFile(Uri.file(fp));

            const first = controller.reopenWithEncoding("windows1251");
            const second = controller.reopenWithEncoding("koi8r");

            expect(await first).toBe(false);
            expect(await second).toBe(true);
            expect(controller.encoding).toBe("koi8r");
            expect(controller.getText()).toBe("\u0442\u0435\u043a\u0441\u0442\n"); // "tekst"
            controller.dispose();
        });

        it("Save As to another path: the old file does not return to the buffer", async () => {
            const controller = createEditorPane();
            const fp = writeBytes("race-from.txt", iconv.encode("old\n", "windows1251"));
            controller.openFile(Uri.file(fp));
            controller.applyExternalEdits([createTextEdit(createRange(0, 0, 0, 0), "new ")], "test edit");
            const edited = controller.getText();

            const pending = controller.reopenWithEncoding("windows1251");
            const saving = controller.saveAs(ws.path("race-to.txt"));

            expect(await pending).toBe(false);
            await saving;
            expect(controller.getText()).toBe(edited);
            expect(controller.encoding).toBe("utf8");
            controller.dispose();
        });

        it("dispose: a closed model is not reread", async () => {
            const controller = createEditorPane();
            const fp = writeBytes("race-dispose.txt", iconv.encode("text\n", "windows1251"));
            controller.openFile(Uri.file(fp));

            const pending = controller.reopenWithEncoding("windows1251");
            controller.dispose();

            expect(await pending).toBe(false);
            expect(controller.encoding).toBe("utf8");
        });
    });

    it("DoD #106: roundtrip cp1251 read → edit → write byte for byte", async () => {
        const controller = createEditorPane();
        const original =
            "\u043f\u0435\u0440\u0432\u0430\u044f \u0441\u0442\u0440\u043e\u043a\u0430\n\u0432\u0442\u043e\u0440\u0430\u044f \u0441\u0442\u0440\u043e\u043a\u0430\n"; // "pervaya stroka", "vtoraya stroka"
        const fp = writeBytes("roundtrip.txt", iconv.encode(original, "windows1251"));
        controller.openFile(Uri.file(fp));
        await controller.reopenWithEncoding("windows1251");

        controller.applyExternalEdits(
            [createTextEdit(createRange(0, 0, 0, 0), "\u043f\u0440\u0430\u0432\u043a\u0430: ")],
            "test edit",
        ); // "pravka"
        await controller.save();

        const expected = iconv.encode("\u043f\u0440\u0430\u0432\u043a\u0430: " + original, "windows1251"); // "pravka"
        expect([...fs.readFileSync(fp)]).toEqual([...expected]);
        controller.dispose();
    });

    it("utf8bom: BOM survives save", async () => {
        const controller = createEditorPane();
        const fp = writeBytes("bom.txt", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("x\n", "utf8")]));
        controller.openFile(Uri.file(fp));
        expect(controller.encoding).toBe("utf8bom");

        controller.applyExternalEdits([createTextEdit(createRange(0, 0, 0, 0), "y")], "test edit");
        await controller.save();

        const written = fs.readFileSync(fp);
        expect([...written.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
        expect(written.subarray(3).toString("utf8")).toBe("yx\n");
        controller.dispose();
    });

    it("saveWithEncoding writes in the new encoding and changes encoding", async () => {
        const controller = createEditorPane();
        const fp = ws.writeFile("save-as-enc.txt", "\u0401\u043b\u043a\u0430\n"); // "Yolka"
        controller.openFile(Uri.file(fp));
        expect(controller.encoding).toBe("utf8");

        const outcome = await controller.saveWithEncoding("windows1251");

        expect(outcome).toBe("saved");
        expect(controller.encoding).toBe("windows1251");
        expect([...fs.readFileSync(fp)]).toEqual([...iconv.encode("\u0401\u043b\u043a\u0430\n", "windows1251")]); // "Yolka"
        controller.dispose();
    });

    it("saveWithEncoding on an untitled buffer returns no-file but sets the encoding", async () => {
        const controller = createEditorPane();
        expect(await controller.saveWithEncoding("windows1251")).toBe("no-file");
        expect(controller.encoding).toBe("windows1251");
        controller.dispose();
    });

    it("changing the encoding does not affect isModified", () => {
        const controller = createEditorPane();
        const fp = ws.writeFile("clean.txt", "abc\n");
        controller.openFile(Uri.file(fp));
        expect(controller.isModified).toBe(false);

        controller.setEncoding("windows1251");
        expect(controller.isModified).toBe(false);
        controller.dispose();
    });

    it("setEncoding ignores unknown ids", () => {
        const controller = createEditorPane();
        controller.setEncoding("martian");
        expect(controller.encoding).toBe("utf8");
        controller.dispose();
    });

    it("onDidChangeEncoding fires on setEncoding and reopenWithEncoding, but not on a no-op", async () => {
        const controller = createEditorPane();
        const fp = ws.writeFile("events.txt", "abc\n");
        controller.openFile(Uri.file(fp));
        let fired = 0;
        controller.onDidChangeEncoding(() => fired++);

        controller.setEncoding("utf8"); // no-op
        expect(fired).toBe(0);
        controller.setEncoding("koi8r");
        expect(fired).toBe(1);
        await controller.reopenWithEncoding("windows1251");
        expect(fired).toBe(2);
        controller.dispose();
    });

    it("disposing an onDidChangeEncoding subscription twice is safe", () => {
        const controller = createEditorPane();
        let fired = 0;
        const subscription = controller.onDidChangeEncoding(() => fired++);
        subscription.dispose();
        subscription.dispose(); // second dispose: the listener is no longer in the list
        controller.setEncoding("koi8r");
        expect(fired).toBe(0);
        controller.dispose();
    });

    it("revertToDisk re-detects the encoding (BOM sniff, not the previous choice)", async () => {
        const controller = createEditorPane();
        const fp = writeBytes("redetect.txt", iconv.encode("text\n", "windows1251"));
        controller.openFile(Uri.file(fp));
        await controller.reopenWithEncoding("windows1251");
        expect(controller.encoding).toBe("windows1251");

        controller.revertToDisk();
        expect(controller.encoding).toBe("utf8");
        controller.dispose();
    });

    it("opening another file resets the encoding to the new file's detection", async () => {
        const controller = createEditorPane();
        const cyr = writeBytes("one.txt", iconv.encode("text", "windows1251"));
        controller.openFile(Uri.file(cyr));
        await controller.reopenWithEncoding("windows1251");

        const bom = writeBytes("two.txt", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("x")]));
        controller.openFile(Uri.file(bom));
        expect(controller.encoding).toBe("utf8bom");
        controller.dispose();
    });

    it("the save participant snapshot carries encoding", async () => {
        const controller = createEditorPane();
        const fp = writeBytes("snap.txt", iconv.encode("text\n", "windows1251"));
        controller.openFile(Uri.file(fp));
        await controller.reopenWithEncoding("windows1251");

        let seen: string | null = null;
        controller.model.saveParticipant = new TextFileSaveParticipant(() => [
            (snapshot) => {
                seen = snapshot.encoding;
                return Promise.resolve([]);
            },
        ]);
        await controller.save();
        expect(seen).toBe("windows1251");
        controller.dispose();
    });
});
