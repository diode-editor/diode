import { afterEach, describe, expect, it, vi } from "vitest";

import { setUnexpectedErrorHandler } from "../../../../base/common/errors.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { LanguageFeatureRegistry } from "../../../common/languageFeatureRegistry.ts";
import type { DocumentColorProvider, IColorInformation } from "../../../common/languages/iColorSource.ts";
import type { IInlineInsertion } from "../../../common/model/iInlineInsertion.ts";
import { TextDocument } from "../../../common/model/textDocument.ts";

import { ColorDetector, DEFAULT_COLOR_DECORATORS_OPTIONS } from "./colorDetector.ts";
import { DefaultDocumentColorProvider } from "./defaultDocumentColorProvider.ts";

const RED: IColorInformation = {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
    color: { red: 1, green: 0, blue: 0, alpha: 1 },
};

/** A provider whose answers the test releases by hand. */
class PendingProvider implements DocumentColorProvider {
    public calls = 0;
    private readonly resolvers: ((colors: IColorInformation[]) => void)[] = [];

    public provideDocumentColors(): Promise<IColorInformation[]> {
        this.calls++;
        return new Promise((resolve) => this.resolvers.push(resolve));
    }

    public answer(colors: IColorInformation[]): void {
        for (const resolve of this.resolvers.splice(0)) resolve(colors);
    }
}

function setup(
    provider: DocumentColorProvider,
    path = "/a.css",
): {
    detector: ColorDetector;
    document: TextDocument;
    published: (readonly IInlineInsertion[])[];
} {
    const registry = new LanguageFeatureRegistry<DocumentColorProvider>();
    registry.register("*", provider);
    const document = new TextDocument("#f00 x");
    const model = {
        uri: Uri.file(path),
        languageId: "css",
        document,
        onDidChangeLanguage: new Emitter<unknown>().event,
    };
    const published: (readonly IInlineInsertion[])[] = [];
    const detector = new ColorDetector(model, registry, DEFAULT_COLOR_DECORATORS_OPTIONS, (insertions) => {
        published.push(insertions);
    });
    return { detector, document, published };
}

async function flush(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ColorDetector", () => {
    afterEach(() => {
        vi.useRealTimers();
        setUnexpectedErrorHandler((e) => {
            console.error(e);
        });
    });

    it("dispose removes the squares and their decorations, and an answer still on its way is dropped", async () => {
        const provider = new PendingProvider();
        const { detector, document, published } = setup(provider);
        const ids: string[] = [];
        const delta = document.deltaDecorations.bind(document);
        vi.spyOn(document, "deltaDecorations").mockImplementation((oldIds, decorations) => {
            const added = delta(oldIds, decorations);
            ids.push(...added);
            return added;
        });
        provider.answer([RED]);
        await flush();
        expect(published.at(-1)).toHaveLength(1);

        detector.setOptions({ ...DEFAULT_COLOR_DECORATORS_OPTIONS, limit: 7 });
        detector.dispose();
        expect(published.at(-1)).toEqual([]);
        expect(ids).toHaveLength(1);
        expect(ids.map((id) => document.getDecorationRange(id))).toEqual([null]);

        const count = published.length;
        provider.answer([RED]);
        await flush();
        expect(published).toHaveLength(count);
    });

    it("turning off while a request is on its way drops its answer", async () => {
        const provider = new PendingProvider();
        const { detector, published } = setup(provider);

        detector.setOptions({ ...DEFAULT_COLOR_DECORATORS_OPTIONS, enabled: false });
        provider.answer([RED]);
        await flush();

        expect(published).toEqual([]);
        detector.dispose();
    });

    it("turning off cancels a recompute scheduled by an edit, and later edits ask nothing", async () => {
        vi.useFakeTimers();
        const provider = new PendingProvider();
        const { detector, document, published } = setup(provider, "/off.css");
        provider.answer([RED]);
        await vi.advanceTimersByTimeAsync(0);

        document.applyEdits([
            { range: { start: { line: 0, character: 6 }, end: { line: 0, character: 6 } }, text: "y" },
        ]);
        detector.setOptions({ ...DEFAULT_COLOR_DECORATORS_OPTIONS, enabled: false });
        document.applyEdits([
            { range: { start: { line: 0, character: 7 }, end: { line: 0, character: 7 } }, text: "z" },
        ]);
        await vi.advanceTimersByTimeAsync(5000);

        expect(provider.calls).toBe(1);
        expect(published.at(-1)).toEqual([]);
        detector.dispose();
    });

    it("a recompute replaces the previous decorations instead of leaving them in the document", async () => {
        const provider = new PendingProvider();
        const { detector, document } = setup(provider, "/again.css");
        const ids: string[] = [];
        const delta = document.deltaDecorations.bind(document);
        vi.spyOn(document, "deltaDecorations").mockImplementation((oldIds, decorations) => {
            const added = delta(oldIds, decorations);
            ids.push(...added);
            return added;
        });
        provider.answer([RED]);
        await flush();

        detector.setOptions({ ...DEFAULT_COLOR_DECORATORS_OPTIONS, limit: 3 });
        provider.answer([RED]);
        await flush();

        expect(ids).toHaveLength(2);
        expect(document.getDecorationRange(ids[0])).toBeNull();
        expect(document.getDecorationRange(ids[1])).not.toBeNull();
        detector.dispose();
    });

    it("the delay after an edit follows how long the providers took (upstream's feature debounce)", async () => {
        vi.useFakeTimers();
        const slow: DocumentColorProvider & { calls: number } = {
            calls: 0,
            provideDocumentColors() {
                this.calls++;
                return new Promise((resolve) =>
                    setTimeout(() => {
                        resolve([RED]);
                    }, 1000),
                );
            },
        };
        const { detector, document } = setup(slow, "/slow.css");
        await vi.advanceTimersByTimeAsync(1000);
        expect(slow.calls).toBe(1);

        document.applyEdits([
            { range: { start: { line: 0, character: 6 }, end: { line: 0, character: 6 } }, text: "y" },
        ]);
        await vi.advanceTimersByTimeAsync(600);
        expect(slow.calls).toBe(1);
        await vi.advanceTimersByTimeAsync(400);
        expect(slow.calls).toBe(2);
        detector.dispose();
    });

    it("options equal to the current ones do not ask the providers again", () => {
        const provider = new PendingProvider();
        const { detector } = setup(provider);
        expect(provider.calls).toBe(1);

        detector.setOptions({ ...DEFAULT_COLOR_DECORATORS_OPTIONS });
        expect(provider.calls).toBe(1);

        detector.setOptions({ ...DEFAULT_COLOR_DECORATORS_OPTIONS, limit: 1 });
        expect(provider.calls).toBe(2);
        detector.dispose();
    });

    it("a failing default detector is reported, and nothing is drawn", async () => {
        const errors: unknown[] = [];
        setUnexpectedErrorHandler((e) => errors.push(e));
        class FailingDefaultProvider extends DefaultDocumentColorProvider {
            public override provideDocumentColors(): Promise<IColorInformation[] | null> {
                return Promise.reject(new Error("boom"));
            }
        }

        const { detector, published } = setup(new FailingDefaultProvider());
        await flush();

        expect(errors).toEqual([new Error("boom")]);
        expect(published).toEqual([]);
        detector.dispose();
    });
});
