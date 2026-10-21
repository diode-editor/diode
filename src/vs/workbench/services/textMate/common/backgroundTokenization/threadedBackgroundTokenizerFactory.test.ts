import { afterEach, describe, expect, it } from "vitest";

import type { IInProcessTextMateWorker } from "../../../../../../TestUtils/inProcessTextMateWorker.ts";
import {
    builtinGrammarRecords,
    createInProcessTextMateWorker,
} from "../../../../../../TestUtils/inProcessTextMateWorker.ts";
import { createDevAssetAccess } from "../../../../../base/node/assets/createDefaultAssetAccess.ts";
import { createDeleteEdit, createInsertEdit } from "../../../../../editor/common/core/iTextEdit.ts";
import type { ITokenizationSupport } from "../../../../../editor/common/languages.ts";
import { TextDocument } from "../../../../../editor/common/model/textDocument.ts";
import { DocumentTokenStore } from "../../../../../editor/common/tokens/documentTokenStore.ts";
import type { ITextMateTheme } from "../../../themes/common/textMateTheme.ts";
import { createTextMateTheme } from "../../../themes/common/textMateTheme.ts";
import { createBuiltinThemeRegistry } from "../../../themes/common/themeRegistry.ts";
import { TextMateGrammarLoader } from "../textMateGrammarLoader.ts";

import { ThreadedBackgroundTokenizerFactory } from "./threadedBackgroundTokenizerFactory.ts";

const assets = createDevAssetAccess();
const recordsPromise = builtinGrammarRecords(assets);

function theme(label: string): ITextMateTheme {
    const resolved = createBuiltinThemeRegistry().resolve(label);
    if (resolved === undefined) throw new Error(`${label} missing`);
    return createTextMateTheme(resolved);
}

/** TypeScript с многострочными конструкциями: состояние строки зависит от предыдущих. */
function sampleSource(blocks: number): string {
    const lines: string[] = [];
    for (let i = 0; i < blocks; i++) {
        lines.push(
            `/**`,
            ` * Block ${String(i)} with \`code\` and @param tags`,
            ` */`,
            `export function f${String(i)}(x: number): string {`,
            "    const s = `template ${x} line",
            "      continues ${x + 1}`;",
            `    return "v" + s; // trailing`,
            `}`,
        );
    }
    return lines.join("\n");
}

async function until(condition: () => boolean, what: string): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (!condition()) {
        if (Date.now() > deadline) throw new Error(`не дождались: ${what}`);
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
    }
}

/** Токены строк документа, посчитанные одним главным потоком с нуля — эталон сравнения. */
async function referenceTokens(document: TextDocument, textMateTheme: ITextMateTheme): Promise<number[][]> {
    const loader = new TextMateGrammarLoader(assets, await recordsPromise);
    loader.setTheme(textMateTheme);
    const support = (await loader.loadSupport("source.ts"))!;
    const store = new DocumentTokenStore(new TextDocument(document.getText(), "typescript"), support);
    store.forceTokenization(document.lineCount - 1);
    const result = [];
    for (let line = 0; line < document.lineCount; line++) result.push(rawTokens(store, line));
    store.dispose();
    loader.dispose();
    return result;
}

function rawTokens(store: DocumentTokenStore, line: number): number[] {
    const tokens = store.getLineTokens(line);
    if (tokens === undefined) return [];
    const result: number[] = [];
    for (let i = 0; i < tokens.getCount(); i++) result.push(tokens.getEndOffset(i), tokens.getMetadata(i));
    return result;
}

interface IHarness {
    readonly worker: IInProcessTextMateWorker;
    readonly factory: ThreadedBackgroundTokenizerFactory;
    readonly support: ITokenizationSupport;
    readonly loader: TextMateGrammarLoader;
}

const harnesses: IHarness[] = [];

async function createHarness(textMateTheme = theme("Dark Modern")): Promise<IHarness> {
    const records = await recordsPromise;
    const worker = createInProcessTextMateWorker();
    const factory = new ThreadedBackgroundTokenizerFactory(worker.spawn, assets, () => true);
    factory.setGrammarDefinitions(records);
    factory.acceptTheme(textMateTheme);
    const loader = new TextMateGrammarLoader(assets, records);
    loader.setTheme(textMateTheme);
    const support = (await loader.loadSupport("source.ts", (document, store) =>
        factory.createBackgroundTokenizer(document, store, "source.ts"),
    ))!;
    const harness = { worker, factory, support, loader };
    harnesses.push(harness);
    return harness;
}

afterEach(() => {
    for (const harness of harnesses.splice(0)) {
        harness.factory.dispose();
        harness.loader.dispose();
        harness.worker.dispose();
    }
});

describe("ThreadedBackgroundTokenizerFactory — фон TextMate в воркере", () => {
    it("воркер докрашивает весь документ: те же токены, что у главного потока, и главный поток не токенизировал", async () => {
        const { support, worker } = await createHarness();
        const document = new TextDocument(sampleSource(60), "typescript");
        const store = new DocumentTokenStore(document, support);

        await until(() => store.isBackgroundTokenizationCompleted, "фон");

        const reference = await referenceTokens(document, theme("Dark Modern"));
        for (let line = 0; line < document.lineCount; line++) {
            expect(rawTokens(store, line), `строка ${String(line)}`).toEqual(reference[line]);
            expect(store.hasAccurateTokensForLine(line)).toBe(true);
        }
        // Всё посчитал воркер: грамматика главного потока так и не компилировалась.
        expect(support.isCold).toBe(true);
        expect(worker.spawned()).toBe(1);
        store.dispose();
    });

    it("правки, пока воркер ещё считает, ложатся поверх его ответов: итог — как токенизация текста после правок", async () => {
        const { support } = await createHarness();
        const document = new TextDocument(sampleSource(150), "typescript");
        const store = new DocumentTokenStore(document, support);

        // Ответы воркера приходят в координатах старых версий, правки — вперемешку с ними.
        document.applyEdits([createInsertEdit(10, 0, "/* open comment\n")]);
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        document.applyEdits([createInsertEdit(300, 4, "`unterminated\nmore\n")]);
        document.applyEdits([createDeleteEdit(2, 0, 5, 0)]);
        await new Promise<void>((resolve) => setTimeout(resolve, 15));
        document.applyEdits([createInsertEdit(500, 0, "*/\n")]);

        await until(() => store.isBackgroundTokenizationCompleted, "фон");
        // Дождаться и ответов на последние правки (флаг «готово» правки не сбрасывают).
        await until(() => {
            for (let line = 0; line < document.lineCount; line++) {
                if (!store.hasAccurateTokensForLine(line) || store.getLineTokens(line) === undefined) return false;
            }
            return true;
        }, "все строки точны");

        const reference = await referenceTokens(document, theme("Dark Modern"));
        for (let line = 0; line < document.lineCount; line++) {
            expect(rawTokens(store, line), `строка ${String(line)}`).toEqual(reference[line]);
        }
        store.dispose();
    });
});
