import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";

import type { ISaveEdit } from "./iSaveParticipant.ts";
import { TextFileSaveParticipant } from "./textFileSaveParticipant.ts";

// #196: the disk write happens regardless: a hung participant is cut off by the timeout,
// a failing one is skipped.

describe("TextFileSaveParticipant — save participant composition", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-save-pipeline-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    const insertAtStart = (text: string): ISaveEdit => ({
        kind: "text",
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        text,
    });

    it("participants run in sequence, each sees the edits of the previous one", async () => {
        const controller = createEditorPane();
        const fp = ws.writeFile("seq.txt", "base");
        controller.openFile(Uri.file(fp));

        const seenTexts: string[] = [];
        controller.model.saveParticipant = new TextFileSaveParticipant(() => [
            (snapshot) => {
                seenTexts.push(snapshot.text);
                return Promise.resolve([insertAtStart("1")]);
            },
            (snapshot) => {
                seenTexts.push(snapshot.text);
                return Promise.resolve([insertAtStart("2")]);
            },
        ]);

        await controller.save();

        expect(seenTexts).toEqual(["base", "1base"]);
        expect(fs.readFileSync(fp, "utf-8")).toBe("21base");
        controller.dispose();
    });

    it("a fresh snapshot carries the current versionId after the previous one's edits", async () => {
        const controller = createEditorPane();
        const fp = ws.writeFile("ver.txt", "v");
        controller.openFile(Uri.file(fp));

        const versions: number[] = [];
        controller.model.saveParticipant = new TextFileSaveParticipant(() => [
            (snapshot) => {
                versions.push(snapshot.versionId);
                return Promise.resolve([insertAtStart("x")]);
            },
            (snapshot) => {
                versions.push(snapshot.versionId);
                return Promise.resolve([]);
            },
        ]);

        await controller.save();

        expect(versions).toHaveLength(2);
        expect(versions[1]).toBeGreaterThan(versions[0]);
        controller.dispose();
    });

    it("a failing participant is skipped, the others and the write still work", async () => {
        const controller = createEditorPane();
        const fp = ws.writeFile("err.txt", "base");
        controller.openFile(Uri.file(fp));

        controller.model.saveParticipant = new TextFileSaveParticipant(() => [
            () => Promise.reject(new Error("boom")),
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the suite checks specifically a non-Error rejection
            () => Promise.reject("nope"),
            () => Promise.resolve([insertAtStart("ok:")]),
        ]);

        const outcome = await controller.save();

        expect(outcome).toBe("saved");
        expect(fs.readFileSync(fp, "utf-8")).toBe("ok:base");
        controller.dispose();
    });

    it("a hung participant is cut by the timeout, saving as is", async () => {
        vi.useFakeTimers();
        try {
            const controller = createEditorPane();
            const fp = ws.writeFile("hang.txt", "base");
            controller.openFile(Uri.file(fp));

            let secondRan = false;
            controller.model.saveParticipant = new TextFileSaveParticipant(() => [
                () => new Promise<ISaveEdit[]>(() => undefined), // never resolves
                () => {
                    secondRan = true;
                    return Promise.resolve([insertAtStart("2:")]);
                },
            ]);

            const savePromise = controller.save();
            await vi.advanceTimersByTimeAsync(4999);
            expect(fs.readFileSync(fp, "utf-8")).toBe("base");
            await vi.advanceTimersByTimeAsync(1);
            const outcome = await savePromise;

            expect(outcome).toBe("saved");
            expect(secondRan).toBe(true);
            expect(fs.readFileSync(fp, "utf-8")).toBe("2:base");
            controller.dispose();
        } finally {
            vi.useRealTimers();
        }
    });

    it("the timeout timer is cleared when the participant answers itself (resolve and reject)", async () => {
        // Fake only the timers under test: setImmediate stays real, since background
        // tokenization of the open buffer (DocumentTokenStore) runs on it, and its
        // queued chunk is not a leak of this scenario.
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
        try {
            const controller = createEditorPane();
            const fp = ws.writeFile("timers.txt", "x");
            controller.openFile(Uri.file(fp));

            controller.model.saveParticipant = new TextFileSaveParticipant(() => [
                () => Promise.resolve([]),
                () => Promise.reject(new Error("boom")),
            ]);

            await controller.save();

            expect(vi.getTimerCount()).toBe(0);
            controller.dispose();
        } finally {
            vi.useRealTimers();
        }
    });

    it("the participant provider is called on EVERY save (live settings)", async () => {
        const controller = createEditorPane();
        const fp = ws.writeFile("live.txt", "x");
        controller.openFile(Uri.file(fp));

        let calls = 0;
        controller.model.saveParticipant = new TextFileSaveParticipant(() => {
            calls++;
            return [];
        });

        await controller.save();
        await controller.save();

        expect(calls).toBe(2);
        controller.dispose();
    });
    it("clamps edit ranges to the document bounds", async () => {
        const controller = createEditorPane();
        const fp = ws.writeFile("clamp.txt", "ab\ncd");
        controller.openFile(Uri.file(fp));
        controller.model.saveParticipant = new TextFileSaveParticipant(() => [
            () =>
                Promise.resolve<ISaveEdit[]>([
                    {
                        kind: "text",
                        range: { start: { line: 99, character: 99 }, end: { line: 99, character: 99 } },
                        text: "A",
                    },
                    {
                        kind: "text",
                        range: { start: { line: -1, character: -1 }, end: { line: -1, character: -1 } },
                        text: "B",
                    },
                    {
                        kind: "text",
                        range: { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } },
                        text: "C",
                    },
                ]),
        ]);

        await controller.save();

        expect(fs.readFileSync(fp, "utf-8")).toBe("BaCb\ncdA");
        controller.dispose();
    });

    it("participant edits are one undo step labelled with the pipeline", async () => {
        const undoRedoService = new UndoRedoService();
        const controller = createEditorPane({ undoRedoService });
        const fp = ws.writeFile("undo.txt", "x");
        controller.openFile(Uri.file(fp));
        controller.model.saveParticipant = new TextFileSaveParticipant(() => [
            () => Promise.resolve([insertAtStart("1"), insertAtStart("2")]),
        ]);

        await controller.save();

        expect(undoRedoService.peekUndo(controller.model.undoContext)?.label).toBe("editorconfig: pre-save");
        controller.dispose();
    });
});
