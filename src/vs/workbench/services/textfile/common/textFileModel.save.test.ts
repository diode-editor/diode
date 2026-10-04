import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";

import type { ISaveEdit, SaveParticipant } from "./iSaveParticipant.ts";
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

    function setParticipant(controller: TextEditorPane, participant: SaveParticipant): void {
        controller.model.saveParticipant = new TextFileSaveParticipant(() => [participant]);
    }

    it("применяет текстовые правки участника перед записью", async () => {
        const controller = createEditorPane();
        const fp = writeFile("a.txt", "abc   \n");
        controller.openFile(Uri.file(fp));
        // Удаляем хвостовые пробелы: правка стирает диапазон 3..6 строки 0.
        setParticipant(controller, () =>
            Promise.resolve<ISaveEdit[]>([
                { kind: "text", range: { start: { line: 0, character: 3 }, end: { line: 0, character: 6 } }, text: "" },
            ]),
        );

        await controller.save();

        expect(fs.readFileSync(fp, "utf-8")).toBe("abc\n");
        controller.dispose();
    });

    it("смена EOL из участника (kind: eol) пишет CRLF", async () => {
        const controller = createEditorPane();
        const fp = writeFile("eol.txt", "a\nb\n");
        controller.openFile(Uri.file(fp));
        setParticipant(controller, () => Promise.resolve<ISaveEdit[]>([{ kind: "eol", eol: EndOfLine.CRLF }]));

        await controller.save();

        expect(fs.readFileSync(fp, "utf-8")).toBe("a\r\nb\r\n");
        controller.dispose();
    });

    it("saveAs тоже прогоняет участника", async () => {
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

    it("save пишет файл атомарно через файловый сервис", async () => {
        const controller = createEditorPane();
        const fp = writeFile("plain.txt", "keep   \n");
        controller.openFile(Uri.file(fp));
        const inode = fs.statSync(fp).ino;

        await expect(controller.save()).resolves.toBe("saved");

        expect(fs.readFileSync(fp, "utf-8")).toBe("keep   \n");
        // Атомарная замена — новый файл (временный сосед + rename).
        expect(fs.statSync(fp).ino).not.toBe(inode);
        controller.dispose();
    });

    it("saveAs пишет новый файл через файловый сервис", async () => {
        const controller = createEditorPane();
        const fp = writeFile("plain2.txt", "as\n");
        controller.openFile(Uri.file(fp));

        const dst = ws.path("plain2-dst.txt");
        await controller.saveAs(dst);

        expect(fs.readFileSync(dst, "utf-8")).toBe("as\n");
        controller.dispose();
    });

    it("saveAs поверх существующего файла — атомарно; следующий save без ложного конфликта", async () => {
        const controller = createEditorPane();
        const fp = writeFile("from.txt", "body\n");
        const dst = writeFile("to.txt", "old\n");
        const inode = fs.statSync(dst).ino;
        controller.openFile(Uri.file(fp));

        await controller.saveAs(dst);
        expect(fs.statSync(dst).ino).not.toBe(inode);

        // Снимок диска после saveAs — от записанного файла: своя запись не конфликт.
        await expect(controller.save()).resolves.toBe("saved");
        expect(controller.model.hasDiskConflict).toBe(false);
        controller.dispose();
    });

    it("файл изменили снаружи, пока работал участник — конфликт, диск не тронут", async () => {
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

    it("overwrite пишет поверх изменённого участником-соседом файла", async () => {
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

    it("файла не было при открытии — гарда нет, save его создаёт", async () => {
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

    it("ошибка записи, отличная от конфликта, доходит до вызывающего", async () => {
        const controller = createEditorPane();
        const fp = writeFile("dir-target.txt", "x\n");
        controller.openFile(Uri.file(fp));
        fs.rmSync(fp);
        fs.mkdirSync(fp);

        // overwrite — мимо гардов: до записи доходит каталог на месте файла.
        await expect(controller.save({ overwrite: true })).rejects.toThrow();
        expect(controller.model.hasDiskConflict).toBe(false);
        controller.dispose();
    });
});
