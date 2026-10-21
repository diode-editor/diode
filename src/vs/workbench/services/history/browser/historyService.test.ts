import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeHistoryEditorSource } from "../../../../../TestUtils/HistoryEditorSourceFake.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../../../base/common/uri.ts";

import { HistoryService } from "./historyService.ts";

describe("HistoryService: navigation stack", () => {
    let ws: ITempWorkspace;
    let source: FakeHistoryEditorSource;

    // Entries are pruned by whether the file exists, so the resources are real.
    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-history-",
            files: { "alpha.ts": "alpha\n", "beta.ts": "beta\n" },
        });
        source = new FakeHistoryEditorSource();
    });

    afterEach(() => {
        ws.dispose();
    });

    const uri = (name: string): string => Uri.file(ws.path(name)).toString();
    const alpha = (): string => uri("alpha.ts");
    const beta = (): string => uri("beta.ts");

    /** The service is created after seeding, to also check pickup of the active editor. */
    const createService = (): HistoryService => new HistoryService(source, source);

    it("empty stack: nowhere to go, goBack/goForward are no-ops", () => {
        const service = createService();

        expect(service.canGoBack).toBe(false);
        expect(service.canGoForward).toBe(false);
        service.goBack();
        service.goForward();

        expect(service.getEntries()).toEqual([]);
        expect(service.currentIndex).toBe(-1);
    });

    it("picks up an editor that became active before the service was created", () => {
        source.open(alpha());
        source.moveCaret(7);

        const service = createService();

        expect(service.getEntries()).toMatchObject([{ line: 7 }]);
    });

    it("a cross-file move pushes an entry, Back returns the file and position", () => {
        const service = createService();
        source.open(alpha());
        source.moveCaret(40);
        source.open(beta());

        expect(service.canGoBack).toBe(true);
        service.goBack();

        expect(source.caret()).toEqual({ uri: alpha(), line: 40, character: 0 });
        expect(service.currentIndex).toBe(1);
    });

    it("a move closer than the significance threshold updates the entry instead of growing the stack", () => {
        const service = createService();
        source.open(alpha());
        source.moveCaret(5);
        source.moveCaret(9);

        expect(service.getEntries()).toMatchObject([{ line: 9 }]);
    });

    it("a move at the threshold or beyond adds a new entry", () => {
        const service = createService();
        source.open(alpha());
        source.moveCaret(10);

        expect(service.getEntries()).toMatchObject([{ line: 0 }, { line: 10 }]);
    });

    it("Back → Forward returns to the point we left", () => {
        const service = createService();
        source.open(alpha());
        source.moveCaret(40);
        source.open(beta());
        source.moveCaret(5);

        service.goBack();
        expect(source.caret()).toMatchObject({ uri: alpha(), line: 40 });

        expect(service.canGoForward).toBe(true);
        service.goForward();

        expect(source.caret()).toMatchObject({ uri: beta(), line: 5 });
    });

    it("a small move after Back does not eat the forward tail, a significant one cuts it", () => {
        const service = createService();
        source.open(alpha());
        source.moveCaret(40);
        source.open(beta());
        service.goBack();

        source.moveCaret(43);
        expect(service.canGoForward).toBe(true);

        source.moveCaret(80);
        expect(service.canGoForward).toBe(false);
        expect(service.getEntries()).toMatchObject([{ line: 0 }, { line: 43 }, { line: 80 }]);
        expect(service.getEntries()[2].uri.toString()).toBe(alpha());
    });

    it("stack cap: the oldest entries drop out, the pointer stays on the last one", () => {
        const service = createService();
        source.open(alpha());
        for (let i = 1; i <= 60; i++) source.moveCaret(i * 20);

        const entries = service.getEntries();
        expect(entries).toHaveLength(50);
        // 61 entries in total (initial + 60 jumps), the first 11 dropped.
        expect(entries[0]).toMatchObject({ line: 220 });
        expect(entries[49]).toMatchObject({ line: 1200 });
        expect(service.currentIndex).toBe(49);
    });

    it("restoring a position is not written to the stack by itself", () => {
        const service = createService();
        source.open(alpha());
        source.moveCaret(40);
        source.open(beta());

        service.goBack();

        expect(service.getEntries()).toHaveLength(3);
        expect(service.currentIndex).toBe(1);
        expect(service.canGoForward).toBe(true);
    });

    it("a position past the end of the document is rewritten with the actual one", () => {
        const service = createService();
        source.open(beta());
        source.moveCaret(100);
        source.open(alpha());

        source.lineCounts.set(beta(), 5);
        source.close(beta());
        service.goBack();

        expect(source.caret()).toMatchObject({ uri: beta(), line: 4 });
        expect(service.getEntries()[service.currentIndex]).toMatchObject({ line: 4 });
    });

    it("non-restorable schemes do not land on the stack", () => {
        const service = createService();
        source.open(alpha());
        source.open("output:extensions");

        expect(service.getEntries()).toMatchObject([{ line: 0 }]);
        expect(service.getEntries()[0].uri.toString()).toBe(alpha());
    });

    it("after dispose the subscriptions are removed", () => {
        const service = createService();
        source.open(alpha());
        service.dispose();

        source.open(beta());
        source.moveCaret(40);

        expect(service.getEntries()).toHaveLength(1);
    });
});
