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

function setup(provider: DocumentColorProvider): {
    detector: ColorDetector;
    document: TextDocument;
    published: (readonly IInlineInsertion[])[];
} {
    const registry = new LanguageFeatureRegistry<DocumentColorProvider>();
    registry.register("*", provider);
    const document = new TextDocument("#f00 x");
    const model = {
        uri: Uri.file("/a.css"),
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
