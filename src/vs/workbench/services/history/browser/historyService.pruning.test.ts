import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeHistoryEditorSource } from "../../../../../TestUtils/HistoryEditorSourceFake.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../../../base/common/uri.ts";

import { HistoryService } from "./historyService.ts";

const UNTITLED = "untitled:Untitled-1";

describe("HistoryService: pruning the stack and the group", () => {
    let ws: ITempWorkspace;
    let source: FakeHistoryEditorSource;
    let service: HistoryService;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-history-prune-",
            files: { "alpha.ts": "alpha\n", "beta.ts": "beta\n", "gamma.ts": "gamma\n" },
        });
        source = new FakeHistoryEditorSource();
        service = new HistoryService(source, source);
    });

    afterEach(() => {
        ws.dispose();
    });

    const uri = (name: string): string => Uri.file(ws.path(name)).toString();
    const alpha = (): string => uri("alpha.ts");
    const beta = (): string => uri("beta.ts");
    const gamma = (): string => uri("gamma.ts");

    it("a file deleted from disk drops out: Back skips to a live entry", () => {
        source.open(gamma());
        source.open(alpha());
        source.open(beta());

        fs.rmSync(ws.path("alpha.ts"));
        service.goBack();

        expect(source.caret()).toMatchObject({ uri: gamma() });
        expect(service.getEntries()).toHaveLength(2);
        expect(service.canGoBack).toBe(false);
    });

    it("a dropped entry ahead of the pointer does not move it", () => {
        source.open(alpha());
        source.open(beta());
        source.open(gamma());
        service.goBack();
        service.goBack();

        fs.rmSync(ws.path("gamma.ts"));
        service.goBack();

        expect(service.getEntries()).toHaveLength(2);
        expect(service.currentIndex).toBe(0);
        expect(service.canGoForward).toBe(true);
    });

    it("a dropped entry under the pointer moves the pointer BACK, not forward", () => {
        source.open(alpha());
        source.open(beta());
        source.open(gamma());
        service.goBack(); // pointer at beta

        fs.rmSync(ws.path("beta.ts"));
        service.goForward();

        // Had the pointer moved forward, Forward would hit the end of the stack and the cursor would stay on beta.
        expect(source.caret()).toMatchObject({ uri: gamma() });
        expect(service.getEntries()).toHaveLength(2);
    });

    it("a dropped entry behind the pointer does not change its position", () => {
        source.open(alpha());
        source.open(beta());
        source.open(gamma());
        service.goBack(); // pointer at beta

        fs.rmSync(ws.path("gamma.ts"));
        service.goBack();

        // The case above has the pointer at zero, where Math.max hides an extra decrement; here it is at one.
        expect(source.caret()).toMatchObject({ uri: alpha() });
        expect(service.currentIndex).toBe(0);
    });

    it("returning to a shrunken file does not eat the forward tail", () => {
        source.lineCounts.set(alpha(), 200);
        source.open(alpha());
        source.moveCaret(150);
        source.open(beta());
        // Line 150 no longer exists in the reopened file.
        source.close(alpha());
        source.lineCounts.set(alpha(), 3);

        service.goBack();

        // A jump to the last line would be significant, but a restore does not count as a record.
        expect(source.caret()).toMatchObject({ uri: alpha(), line: 2 });
        service.goForward();
        expect(source.caret()).toMatchObject({ uri: beta() });
    });

    it("Back into another group does not eat the forward tail", () => {
        source.addGroup(2);
        source.focusGroup(1);
        source.open(alpha());
        source.focusGroup(2);
        source.open(beta());

        service.goBack();
        expect(source.caret()).toMatchObject({ uri: alpha() });

        service.goForward();
        expect(source.caret()).toMatchObject({ uri: beta() });
    });

    it("an untitled buffer open in one of two groups stays reachable", () => {
        // Groups are created before the entries: reachability of an untitled is checked across ALL
        // groups of the strip, and one must suffice, the one where it is open.
        source.addGroup(2);
        source.focusGroup(1);
        source.open(UNTITLED);
        source.open(alpha());

        service.goBack();

        expect(source.caret()).toMatchObject({ uri: UNTITLED });
        expect(service.getEntries()).toHaveLength(2);
    });

    it("a closed tab of a live file stays in history: Back reopens it", () => {
        source.open(alpha());
        source.moveCaret(30);
        source.open(beta());
        source.close(alpha());

        service.goBack();

        expect(source.openUriCalls).toContain(alpha());
        expect(source.caret()).toMatchObject({ uri: alpha(), line: 30 });
    });

    it("a closed untitled buffer drops out: there is nothing to open it with", () => {
        source.open(UNTITLED);
        source.open(alpha());
        source.close(UNTITLED);
        source.openUriCalls.length = 0;

        // Real openUri on a closed untitled: it would throw, so the entry must be gone before.
        service.goBack();

        expect(source.openUriCalls).toEqual([]);
        expect(service.getEntries()).toHaveLength(1);
        expect(service.canGoBack).toBe(false);
    });

    it("a stack from which everything dropped out becomes empty", () => {
        source.open(UNTITLED);
        source.close(UNTITLED);

        service.goBack();

        expect(service.getEntries()).toEqual([]);
        expect(service.currentIndex).toBe(-1);
        expect(service.canGoForward).toBe(false);
    });

    it("closing the active tab moves history to the neighbor; closing the last one resets it", () => {
        source.open(alpha());
        source.open(beta());

        source.close(beta());
        expect(source.caret()).toMatchObject({ uri: alpha() });

        source.close(alpha());
        expect(source.caret()).toBeNull();
    });

    it("an open untitled buffer stays reachable", () => {
        source.open(UNTITLED);
        source.moveCaret(20);
        source.open(alpha());

        service.goBack();

        expect(source.caret()).toMatchObject({ uri: UNTITLED, line: 20 });
    });

    it("a dropped entry under the pointer does not move the pointer below zero", () => {
        source.open(UNTITLED);
        source.open(alpha());
        service.goBack();
        source.close(UNTITLED);

        service.goForward();

        expect(service.getEntries()).toHaveLength(1);
        expect(service.currentIndex).toBe(0);
        expect(service.canGoForward).toBe(false);
    });

    it("the fake mirrors the real openUri refusing to open a closed untitled buffer", () => {
        source.open(UNTITLED);
        source.close(UNTITLED);

        expect(() => {
            source.openUri(Uri.parse(UNTITLED));
        }).toThrow(/^openUri: /);
    });

    it("an entry from another group is restored together with the group focus", () => {
        source.open(alpha());
        source.moveCaret(25);
        source.addGroup(2);
        source.open(beta());

        service.goBack();

        expect(source.focusGroupCalls).toEqual([1]);
        expect(source.caret()).toMatchObject({ uri: alpha(), line: 25 });
    });

    it("an entry from the same group is restored without refocusing the group", () => {
        source.open(alpha());
        source.moveCaret(25);
        source.open(beta());

        service.goBack();

        expect(source.focusGroupCalls).toEqual([]);
        expect(source.caret()).toMatchObject({ uri: alpha(), line: 25 });
    });

    it("a vanished group does not get in the way: the entry opens in the active one", () => {
        source.open(alpha());
        source.moveCaret(25);
        source.addGroup(2);
        source.open(beta());
        source.removeGroup(1);

        service.goBack();

        expect(source.focusGroupCalls).toEqual([]);
        expect(source.caret()).toMatchObject({ uri: alpha(), line: 25 });
    });
});
