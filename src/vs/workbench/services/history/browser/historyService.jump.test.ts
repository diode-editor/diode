import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeHistoryEditorSource } from "../../../../../TestUtils/HistoryEditorSourceFake.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../../../base/common/uri.ts";

import { HistoryService } from "./historyService.ts";

describe("HistoryService: jump seam", () => {
    let ws: ITempWorkspace;
    let source: FakeHistoryEditorSource;
    let service: HistoryService;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-history-jump-",
            files: { "alpha.ts": "alpha\n", "beta.ts": "beta\n" },
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

    it("a cross-file jump pushes exactly two entries: origin and target", () => {
        source.open(alpha());
        source.moveCaret(20);

        service.jump(() => {
            source.open(beta());
            source.moveCaret(50);
        });

        const entries = service.getEntries();
        expect(entries).toMatchObject([{ line: 0 }, { line: 20 }, { line: 50 }]);
        expect(entries[2].uri.toString()).toBe(beta());
        expect(service.currentIndex).toBe(2);

        service.goBack();
        expect(source.caret()).toMatchObject({ uri: alpha(), line: 20 });
    });

    it("an intentional jump closer than the significance threshold still lands on the stack", () => {
        source.open(alpha());

        service.jump(() => {
            source.moveCaret(3);
        });

        expect(service.getEntries()).toMatchObject([{ line: 0 }, { line: 3 }]);
    });

    it("a jump without an active editor does not throw and writes nothing", () => {
        service.jump(() => undefined);

        expect(service.getEntries()).toEqual([]);
    });

    it("returns the navigation result", () => {
        source.open(alpha());

        expect(service.jump(() => "done")).toBe("done");
    });

    it("an exception inside the navigation does not leave history muted", () => {
        source.open(alpha());

        expect(() =>
            service.jump(() => {
                throw new Error("navigation failed");
            }),
        ).toThrow("navigation failed");

        source.moveCaret(40);
        expect(service.getEntries()).toMatchObject([{ line: 0 }, { line: 40 }]);
    });

    it("jumpAsync: the destination is captured AFTER the async open", async () => {
        source.open(alpha());
        source.moveCaret(20);
        source.providedSchemes.add("jdt");
        const target = "jdt://contents/lib.jar/pkg/Foo.java";

        await service.jumpAsync(async () => {
            // Content of a non-disk resource arrives from the provider a tick later.
            await Promise.resolve();
            source.open(target);
            source.moveCaret(50);
        });

        const entries = service.getEntries();
        expect(entries).toMatchObject([{ line: 0 }, { line: 20 }, { line: 50 }]);
        expect(entries[2].uri.toString()).toBe(target);
        service.goBack();
        expect(source.caret()).toMatchObject({ uri: alpha(), line: 20 });
    });

    it("jumpAsync: intermediate moves inside the navigation do not land on the stack", async () => {
        source.open(alpha());

        await service.jumpAsync(async () => {
            source.moveCaret(5);
            await Promise.resolve();
            source.moveCaret(50);
        });

        expect(service.getEntries()).toMatchObject([{ line: 0 }, { line: 50 }]);
    });

    it("jumpAsync: a failed navigation does not leave history muted", async () => {
        source.open(alpha());

        await expect(
            service.jumpAsync(async () => {
                await Promise.resolve();
                throw new Error("navigation failed");
            }),
        ).rejects.toThrow("navigation failed");

        source.moveCaret(40);
        expect(service.getEntries()).toMatchObject([{ line: 0 }, { line: 40 }]);
    });

    it("a non-disk resource without a scheme provider is not written to the stack", () => {
        source.open(alpha());

        service.jump(() => {
            source.open("output:extensions");
            source.moveCaret(50);
        });

        expect(service.getEntries().map((e) => e.uri.scheme)).toEqual(["file"]);
    });
});
