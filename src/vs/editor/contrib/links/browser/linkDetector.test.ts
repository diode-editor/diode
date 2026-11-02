import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CancellationTokenSource } from "../../../../base/common/cancellation.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange, type IRange } from "../../../common/core/iRange.ts";
import { createTextEdit } from "../../../common/core/iTextEdit.ts";
import { LanguageFeatureRegistry } from "../../../common/languageFeatureRegistry.ts";
import { SCAN_BATCH_LINES } from "../../../common/languages/idleDocumentScan.ts";
import type { ILink, ILinkRequest, LinkProvider } from "../../../common/languages/iLinkSource.ts";
import { TextDocument } from "../../../common/model/textDocument.ts";

import { DefaultLinkProvider, registerDefaultLinkProvider } from "./defaultLinkProvider.ts";
import { type ILinkDetectorModel, LinkDetector } from "./linkDetector.ts";

/** Past upstream's `min` of the debounce. */
const DEBOUNCE_MS = 1000;

interface IFixture {
    readonly document: TextDocument;
    readonly language: Emitter<unknown>;
    readonly registry: LanguageFeatureRegistry<LinkProvider>;
    readonly ranges: () => readonly IRange[];
    readonly detector: LinkDetector;
    readonly calls: () => number;
}

let nextFile = 0;

describe("LinkDetector", () => {
    const toDispose: { dispose(): void }[] = [];

    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        for (const item of toDispose.splice(0)) item.dispose();
        vi.useRealTimers();
    });

    function fixture(text: string, enabled = true, answer?: () => readonly ILink[]): IFixture {
        const document = new TextDocument(text);
        const language = new Emitter<unknown>();
        const model: ILinkDetectorModel = {
            // The debounce is shared per document: every test its own file, so none inherits another's timing.
            uri: Uri.file(`/link-detector-${String(nextFile++)}.txt`),
            languageId: "plaintext",
            document,
            onDidChangeLanguage: language.event,
        };
        const registry = new LanguageFeatureRegistry<LinkProvider>();
        const provide = vi.fn((request: ILinkRequest) =>
            Promise.resolve(
                answer?.() ??
                    [...request.document.getLineContent(0).matchAll(/l\w+/g)].map((match) => ({
                        range: createRange(0, match.index, 0, match.index + match[0].length),
                        url: match[0],
                    })),
            ),
        );
        registry.register("*", { provideLinks: provide });
        let ranges: readonly IRange[] = [];
        const detector = new LinkDetector(model, registry, enabled, (next) => {
            ranges = next;
        });
        toDispose.push(detector);
        return { document, language, registry, ranges: () => ranges, detector, calls: () => provide.mock.calls.length };
    }

    function edit(document: TextDocument, line: number, character: number, text: string): void {
        document.applyEdits([createTextEdit(createRange(line, character, line, character), text)]);
    }

    it("asks on open and publishes the ranges", async () => {
        const { ranges } = fixture("a link b");
        await vi.advanceTimersByTimeAsync(0);
        expect(ranges()).toEqual([createRange(0, 2, 0, 6)]);
    });

    it("the underline follows the text at once, before the next answer", async () => {
        const { document, ranges, calls } = fixture("a link b");
        await vi.advanceTimersByTimeAsync(0);
        edit(document, 0, 0, "xx");
        expect(ranges()).toEqual([createRange(0, 4, 0, 8)]);
        expect(calls()).toBe(1);
    });

    it("does not grow when typing at its edges", async () => {
        const { document, ranges } = fixture("a link b");
        await vi.advanceTimersByTimeAsync(0);
        edit(document, 0, 6, "x");
        expect(ranges()).toEqual([createRange(0, 2, 0, 6)]);
        edit(document, 0, 2, "y");
        expect(ranges()).toEqual([createRange(0, 3, 0, 7)]);
    });

    it("a link whose text is gone is dropped at once", async () => {
        const { document, ranges } = fixture("a link b");
        await vi.advanceTimersByTimeAsync(0);
        document.applyEdits([createTextEdit(createRange(0, 2, 0, 6), "")]);
        expect(ranges()).toEqual([]);
    });

    it("an edit asks again after the debounce, and each edit restarts it", async () => {
        const { document, ranges, calls } = fixture("a link b");
        await vi.advanceTimersByTimeAsync(0);
        edit(document, 0, 8, " lmore");
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
        expect(calls()).toBe(1);
        edit(document, 0, 14, "x");
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
        expect(calls()).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(calls()).toBe(2);
        expect(ranges()).toEqual([createRange(0, 2, 0, 6), createRange(0, 9, 0, 15)]);
    });

    it("a language change and a new provider ask at once", async () => {
        const { language, registry, calls } = fixture("a link b");
        await vi.advanceTimersByTimeAsync(0);
        language.fire(undefined);
        expect(calls()).toBe(2);
        await vi.advanceTimersByTimeAsync(0);
        toDispose.push(registry.register("*", { provideLinks: () => Promise.resolve([]) }));
        expect(calls()).toBe(3);
    });

    it("an answer to an old text is dropped", async () => {
        const { document, ranges } = fixture("a link b");
        edit(document, 0, 0, "xx");
        await vi.advanceTimersByTimeAsync(0);
        expect(ranges()).toEqual([]);
    });

    it("an answer superseded by a newer request is dropped", async () => {
        let resolveFirst: (links: readonly ILink[]) => void = () => undefined;
        const document = new TextDocument("text");
        const language = new Emitter<unknown>();
        const registry = new LanguageFeatureRegistry<LinkProvider>();
        const answers = [
            new Promise<readonly ILink[]>((resolve) => {
                resolveFirst = resolve;
            }),
            Promise.resolve([{ range: createRange(0, 0, 0, 2), url: "second" }]),
        ];
        registry.register("*", { provideLinks: () => answers.shift() ?? Promise.resolve([]) });
        const seen: (readonly IRange[])[] = [];
        toDispose.push(
            new LinkDetector(
                { uri: Uri.file("/superseded.txt"), languageId: "x", document, onDidChangeLanguage: language.event },
                registry,
                true,
                (ranges) => seen.push(ranges),
            ),
        );
        language.fire(undefined);
        await vi.advanceTimersByTimeAsync(0);
        resolveFirst([{ range: createRange(0, 2, 0, 4), url: "first" }]);
        await vi.advanceTimersByTimeAsync(0);
        expect(seen).toEqual([[createRange(0, 0, 0, 2)]]);
    });

    it("off: asks nobody; turned off: the underlines go at once; turned on: asks again", async () => {
        const { detector, ranges, calls } = fixture("a link b", false);
        await vi.advanceTimersByTimeAsync(0);
        expect(calls()).toBe(0);

        detector.setEnabled(true);
        await vi.advanceTimersByTimeAsync(0);
        expect(ranges()).toEqual([createRange(0, 2, 0, 6)]);

        detector.setEnabled(false);
        expect(ranges()).toEqual([]);
        expect(detector.getLinkAt({ line: 0, character: 3 })).toBeNull();
    });

    it("off: an edit asks nobody; the same value twice changes nothing", async () => {
        const { detector, document, calls } = fixture("a link b");
        await vi.advanceTimersByTimeAsync(0);
        detector.setEnabled(true);
        expect(calls()).toBe(1);
        detector.setEnabled(false);
        edit(document, 0, 0, "x");
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 5);
        expect(calls()).toBe(1);
    });

    it("turning off in flight drops the answer", async () => {
        const { detector, ranges } = fixture("a link b");
        detector.setEnabled(false);
        await vi.advanceTimersByTimeAsync(0);
        expect(ranges()).toEqual([]);
    });

    it("dispose removes the decorations and drops the pending edit", async () => {
        const { detector, document, ranges, calls } = fixture("a link b");
        await vi.advanceTimersByTimeAsync(0);
        edit(document, 0, 0, "x");
        detector.dispose();
        expect(ranges()).toEqual([]);
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 5);
        expect(calls()).toBe(1);
    });

    describe("getLinkAt", () => {
        it("the bounds count; a position outside finds nothing", async () => {
            const { detector } = fixture("a link b");
            await vi.advanceTimersByTimeAsync(0);
            expect(detector.getLinkAt({ line: 0, character: 1 })).toBeNull();
            expect(detector.getLinkAt({ line: 0, character: 2 })?.url).toBe("link");
            expect(detector.getLinkAt({ line: 0, character: 4 })?.url).toBe("link");
            expect(detector.getLinkAt({ line: 0, character: 6 })?.url).toBe("link");
            expect(detector.getLinkAt({ line: 0, character: 7 })).toBeNull();
        });

        it("of two adjacent links the one the position is inside wins", async () => {
            const links = [
                { range: createRange(0, 0, 0, 4), url: "left" },
                { range: createRange(0, 4, 0, 8), url: "right" },
            ];
            const { detector } = fixture("abcdefgh", true, () => links);
            await vi.advanceTimersByTimeAsync(0);
            expect(detector.getLinkAt({ line: 0, character: 4 })?.url).toBe("right");
            expect(detector.getLinkAt({ line: 0, character: 8 })?.url).toBe("right");
        });

        it("answers by position whatever order the provider gave", async () => {
            const links = [
                { range: createRange(0, 6, 0, 8), url: "late" },
                { range: createRange(0, 0, 0, 2), url: "early" },
            ];
            const { detector, ranges } = fixture("abcdefgh", true, () => links);
            await vi.advanceTimersByTimeAsync(0);
            expect(ranges()).toEqual([createRange(0, 0, 0, 2), createRange(0, 6, 0, 8)]);
            expect(detector.getLinkAt({ line: 0, character: 7 })?.url).toBe("late");
        });

        it("follows the text, and a collapsed link is no link", async () => {
            const { detector, document } = fixture("a link b");
            await vi.advanceTimersByTimeAsync(0);
            edit(document, 0, 0, "xx");
            expect(detector.getLinkAt({ line: 0, character: 2 })).toBeNull();
            expect(detector.getLinkAt({ line: 0, character: 4 })?.url).toBe("link");
            document.applyEdits([createTextEdit(createRange(0, 4, 0, 8), "")]);
            expect(detector.getLinkAt({ line: 0, character: 4 })).toBeNull();
        });
    });
});

describe("DefaultLinkProvider", () => {
    function request(document: TextDocument): ILinkRequest {
        return { uri: "file:///a", languageId: "x", versionId: document.versionId, document };
    }

    it("finds the links of every line, across several slices", async () => {
        const lines = Array.from({ length: SCAN_BATCH_LINES * 2 + 1 }, () => "x");
        lines[0] = "http://first.one";
        lines[SCAN_BATCH_LINES] = "http://second.one";
        lines[SCAN_BATCH_LINES * 2] = "http://third.one";
        const document = new TextDocument(lines.join("\n"));

        const links = await new DefaultLinkProvider().provideLinks(
            request(document),
            new CancellationTokenSource().token,
        );

        expect(links?.map((link) => [link.range.start.line, link.url])).toEqual([
            [0, "http://first.one"],
            [SCAN_BATCH_LINES, "http://second.one"],
            [SCAN_BATCH_LINES * 2, "http://third.one"],
        ]);
    });

    it("a document above the sync limit is not read; one at the limit is", async () => {
        const document = new TextDocument("http://a.b");
        const token = new CancellationTokenSource().token;
        const size = document.getValueLength();
        await expect(new DefaultLinkProvider(size - 1).provideLinks(request(document), token)).resolves.toBeNull();
        const atLimit = await new DefaultLinkProvider(size).provideLinks(request(document), token);
        expect(atLimit).toHaveLength(1);
    });

    it("registers on every language", () => {
        const documentLinkProvider = new LanguageFeatureRegistry<LinkProvider>();
        const registration = registerDefaultLinkProvider({ documentLinkProvider } as never);
        expect(documentLinkProvider.has({ uri: Uri.file("/a"), languageId: "whatever" })).toBe(true);
        registration.dispose();
    });
});
