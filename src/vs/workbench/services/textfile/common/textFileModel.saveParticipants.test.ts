import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";

import type { ISaveEdit } from "./iSaveParticipant.ts";

// Композиция save-участников (#196, хвост): участники исполняются
// последовательно, каждый получает СВЕЖИЙ снапшот (правки предыдущего уже в
// буфере), зависший режется таймаутом, сбойный пропускается — запись на диск
// происходит в любом случае.

describe("TextFileModel — композиция save-участников", () => {
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

    it("участники идут последовательно, каждый видит правки предыдущего", async () => {
        const controller = createEditorPane();
        const fp = ws.writeFile("seq.txt", "base");
        controller.openFile(Uri.file(fp));

        const seenTexts: string[] = [];
        controller.saveParticipants = () => [
            (snapshot) => {
                seenTexts.push(snapshot.text);
                return Promise.resolve([insertAtStart("1")]);
            },
            (snapshot) => {
                seenTexts.push(snapshot.text);
                return Promise.resolve([insertAtStart("2")]);
            },
        ];

        await controller.save();

        // Второй участник обязан видеть текст УЖЕ с правкой первого.
        expect(seenTexts).toEqual(["base", "1base"]);
        expect(fs.readFileSync(fp, "utf-8")).toBe("21base");
        controller.dispose();
    });

    it("свежий снапшот несёт актуальный versionId после правок предыдущего", async () => {
        const controller = createEditorPane();
        const fp = ws.writeFile("ver.txt", "v");
        controller.openFile(Uri.file(fp));

        const versions: number[] = [];
        controller.saveParticipants = () => [
            (snapshot) => {
                versions.push(snapshot.versionId);
                return Promise.resolve([insertAtStart("x")]);
            },
            (snapshot) => {
                versions.push(snapshot.versionId);
                return Promise.resolve([]);
            },
        ];

        await controller.save();

        expect(versions).toHaveLength(2);
        expect(versions[1]).toBeGreaterThan(versions[0]);
        controller.dispose();
    });

    it("сбойный участник пропускается, остальные и запись работают", async () => {
        const controller = createEditorPane();
        const fp = ws.writeFile("err.txt", "base");
        controller.openFile(Uri.file(fp));

        controller.saveParticipants = () => [
            () => Promise.reject(new Error("boom")),
            // Отказ не-Error значением — тоже пропуск, а не крах save.
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- сьют проверяет ИМЕННО не-Error отказ
            () => Promise.reject("nope"),
            () => Promise.resolve([insertAtStart("ok:")]),
        ];

        const outcome = await controller.save();

        expect(outcome).toBe("saved");
        expect(fs.readFileSync(fp, "utf-8")).toBe("ok:base");
        controller.dispose();
    });

    it("зависший участник режется таймаутом — сохраняем как есть", async () => {
        vi.useFakeTimers();
        try {
            const controller = createEditorPane();
            const fp = ws.writeFile("hang.txt", "base");
            controller.openFile(Uri.file(fp));

            let secondRan = false;
            controller.saveParticipants = () => [
                () => new Promise<ISaveEdit[]>(() => undefined), // никогда не резолвится
                () => {
                    secondRan = true;
                    return Promise.resolve([insertAtStart("2:")]);
                },
            ];

            const savePromise = controller.save();
            // До таймаута запись не происходит — участник ещё «думает».
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

    it("таймер таймаута снимается, когда участник ответил сам (resolve и reject)", async () => {
        vi.useFakeTimers();
        try {
            const controller = createEditorPane();
            const fp = ws.writeFile("timers.txt", "x");
            controller.openFile(Uri.file(fp));

            controller.saveParticipants = () => [() => Promise.resolve([]), () => Promise.reject(new Error("boom"))];

            await controller.save();

            // Оба участника завершились сами — «страховочных» 5с-таймеров не осталось.
            expect(vi.getTimerCount()).toBe(0);
            controller.dispose();
        } finally {
            vi.useRealTimers();
        }
    });

    it("провайдер участников дергается на КАЖДОЕ сохранение (живые настройки)", async () => {
        const controller = createEditorPane();
        const fp = ws.writeFile("live.txt", "x");
        controller.openFile(Uri.file(fp));

        let calls = 0;
        controller.saveParticipants = () => {
            calls++;
            return [];
        };

        await controller.save();
        await controller.save();

        expect(calls).toBe(2);
        controller.dispose();
    });
});
