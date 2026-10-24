import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";

import type { ISaveEdit, SaveParticipant } from "./iSaveParticipant.ts";
import type { TextFileModel } from "./textFileModel.ts";
import { TextFileSaveParticipant } from "./textFileSaveParticipant.ts";

describe("TextFileModel — save participant", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-editorctrl-save-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    function writeFile(name: string, content: string): string {
        return ws.writeFile(name, content);
    }

    function setParticipant(controller: TextEditorPane<TextFileModel>, participant: SaveParticipant): void {
        controller.model.saveParticipant = new TextFileSaveParticipant(() => [participant]);
    }

    it("applies participant text edits before writing", async () => {
        const controller = createEditorPane();
        const fp = writeFile("a.txt", "abc   \n");
        controller.openFile(Uri.file(fp));
        // Trim trailing whitespace: the edit erases range 3..6 of line 0.
        setParticipant(controller, () =>
            Promise.resolve<ISaveEdit[]>([
                { kind: "text", range: { start: { line: 0, character: 3 }, end: { line: 0, character: 6 } }, text: "" },
            ]),
        );

        await controller.save();

        expect(fs.readFileSync(fp, "utf-8")).toBe("abc\n");
        controller.dispose();
    });

    it("the file service gets a stream, not one buffer of the file; edits typed during the write stay unsaved", async () => {
        const files = diskFileService();
        const writes: unknown[] = [];
        const write = files.writeFile.bind(files);
        let typeDuringWrite = (): void => undefined;
        files.writeFile = async (resource, value, options) => {
            writes.push(value);
            typeDuringWrite();
            return write(resource, value, options);
        };
        const controller = createEditorPane({ files });
        const fp = writeFile("streamed.txt", "one\n");
        controller.openFile(Uri.file(fp));
        controller.model.document.applyEdits([
            { range: { start: { line: 0, character: 3 }, end: { line: 0, character: 3 } }, text: "!" },
        ]);
        typeDuringWrite = () => {
            controller.model.document.applyEdits([
                { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "late " },
            ]);
        };

        expect(await controller.model.save()).toBe("saved");

        expect(writes).toHaveLength(1);
        expect(writes[0]).not.toBeInstanceOf(Uint8Array);
        // The file holds the snapshot taken before the write; the late edit is not in it and keeps the buffer dirty.
        expect(fs.readFileSync(fp, "utf-8")).toBe("one!\n");
        expect(controller.model.isModified).toBe(true);
        controller.dispose();
    });

    it("Save As of a modified buffer in conflict with its file: the copy holds the edits, the buffer is clean", async () => {
        const controller = createEditorPane();
        const fp = writeFile("conflict.txt", "one\n");
        controller.openFile(Uri.file(fp));
        controller.model.document.applyEdits([
            { range: { start: { line: 0, character: 3 }, end: { line: 0, character: 3 } }, text: "!" },
        ]);
        // Changed on disk meanwhile: a plain save refuses with a conflict.
        fs.writeFileSync(fp, "someone else's text, longer\n");
        expect(await controller.model.save()).toBe("conflict");
        expect(controller.model.hasDiskConflict).toBe(true);

        const target = ws.path("resolved.txt");
        await controller.model.saveAs(target);

        expect(fs.readFileSync(target, "utf-8")).toBe("one!\n");
        expect(controller.model.isModified).toBe(false);
        expect(controller.model.hasDiskConflict).toBe(false);
        controller.dispose();
    });

    it("an EOL change from a participant (kind: eol) writes CRLF", async () => {
        const controller = createEditorPane();
        const fp = writeFile("eol.txt", "a\nb\n");
        controller.openFile(Uri.file(fp));
        setParticipant(controller, () => Promise.resolve<ISaveEdit[]>([{ kind: "eol", eol: EndOfLine.CRLF }]));

        await controller.save();

        expect(fs.readFileSync(fp, "utf-8")).toBe("a\r\nb\r\n");
        controller.dispose();
    });

    it("saveAs runs the participant too", async () => {
        const controller = createEditorPane();
        const fp = writeFile("src.txt", "hi   \n");
        controller.openFile(Uri.file(fp));
        setParticipant(controller, () =>
            Promise.resolve<ISaveEdit[]>([
                { kind: "text", range: { start: { line: 0, character: 2 }, end: { line: 0, character: 5 } }, text: "" },
            ]),
        );

        const dst = ws.path("dst.txt");
        await controller.saveAs(dst);

        expect(fs.readFileSync(dst, "utf-8")).toBe("hi\n");
        controller.dispose();
    });

    it("save writes the file atomically via the file service", async () => {
        const controller = createEditorPane();
        const fp = writeFile("plain.txt", "keep   \n");
        controller.openFile(Uri.file(fp));
        const inode = fs.statSync(fp).ino;

        await expect(controller.save()).resolves.toBe("saved");

        expect(fs.readFileSync(fp, "utf-8")).toBe("keep   \n");
        expect(fs.statSync(fp).ino).not.toBe(inode);
        controller.dispose();
    });

    it("saveAs writes a new file via the file service", async () => {
        const controller = createEditorPane();
        const fp = writeFile("plain2.txt", "as\n");
        controller.openFile(Uri.file(fp));

        const dst = ws.path("plain2-dst.txt");
        await controller.saveAs(dst);

        expect(fs.readFileSync(dst, "utf-8")).toBe("as\n");
        controller.dispose();
    });

    it("saveAs over an existing file is atomic; the next save has no false conflict", async () => {
        const controller = createEditorPane();
        const fp = writeFile("from.txt", "body\n");
        const dst = writeFile("to.txt", "old\n");
        const inode = fs.statSync(dst).ino;
        controller.openFile(Uri.file(fp));

        await controller.saveAs(dst);
        expect(fs.statSync(dst).ino).not.toBe(inode);

        await expect(controller.save()).resolves.toBe("saved");
        expect(controller.model.hasDiskConflict).toBe(false);
        controller.dispose();
    });

    it("the file changed externally while a participant ran: conflict, disk untouched", async () => {
        const controller = createEditorPane();
        const fp = writeFile("race.txt", "mine\n");
        controller.openFile(Uri.file(fp));
        setParticipant(controller, () => {
            fs.writeFileSync(fp, "theirs, longer\n");
            return Promise.resolve<ISaveEdit[]>([]);
        });

        await expect(controller.save()).resolves.toBe("conflict");

        expect(fs.readFileSync(fp, "utf-8")).toBe("theirs, longer\n");
        expect(controller.model.hasDiskConflict).toBe(true);
        controller.dispose();
    });

    it("overwrite writes over a file changed by a neighbouring participant", async () => {
        const controller = createEditorPane();
        const fp = writeFile("force.txt", "mine\n");
        controller.openFile(Uri.file(fp));
        setParticipant(controller, () => {
            fs.writeFileSync(fp, "theirs, longer\n");
            return Promise.resolve<ISaveEdit[]>([]);
        });

        await expect(controller.save({ overwrite: true })).resolves.toBe("saved");

        expect(fs.readFileSync(fp, "utf-8")).toBe("mine\n");
        expect(controller.model.hasDiskConflict).toBe(false);
        controller.dispose();
    });

    it("the file was missing at open: no guard, save creates it", async () => {
        const controller = createEditorPane();
        const fp = ws.path("fresh.txt");
        controller.openFile(Uri.file(fp));
        setParticipant(controller, () => {
            fs.writeFileSync(fp, "appeared\n");
            return Promise.resolve<ISaveEdit[]>([]);
        });

        await expect(controller.save()).resolves.toBe("saved");

        expect(fs.readFileSync(fp, "utf-8")).toBe("");
        controller.dispose();
    });

    it("a write error other than a conflict reaches the caller", async () => {
        const controller = createEditorPane();
        const fp = writeFile("dir-target.txt", "x\n");
        controller.openFile(Uri.file(fp));
        fs.rmSync(fp);
        fs.mkdirSync(fp);

        // overwrite bypasses the guards, so the write hits a directory in place of the file.
        await expect(controller.save({ overwrite: true })).rejects.toThrow();
        expect(controller.model.hasDiskConflict).toBe(false);
        controller.dispose();
    });
});
