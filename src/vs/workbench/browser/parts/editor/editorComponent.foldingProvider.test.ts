import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { LanguageFeatureRegistry } from "../../../../editor/common/languageFeatureRegistry.ts";
import type { FoldingRangeProvider } from "../../../../editor/common/languages/iFoldingSource.ts";
import type { IFoldingRegion } from "../../../../editor/contrib/folding/iFoldingRegion.ts";

/** The provider merge resolves on a microtask; a macrotask tick flushes it. */
function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function starts(ctrl: TextEditorPane): number[] {
    return ctrl.viewState.foldedRegions.map((r) => r.startLine).sort((a, b) => a - b);
}

/** A folding provider returning fixed regions for any request. */
function providerOf(regions: IFoldingRegion[]): FoldingRangeProvider {
    return { provideFoldingRanges: async () => regions.map((r) => ({ ...r })) };
}

describe("EditorComponent – extension folding provider merge", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-foldprov-" });
    });
    afterEach(() => {
        ws.dispose();
    });

    let providers: LanguageFeatureRegistry<FoldingRangeProvider>;

    function open(content: string): TextEditorPane {
        providers = new LanguageFeatureRegistry<FoldingRangeProvider>();
        const filePath = ws.writeFile("doc.txt", content);
        const ctrl = createEditorPane({ foldingProviders: providers });
        ctrl.openFile(Uri.file(filePath));
        return ctrl;
    }

    it("provider-регион появляется там, где indentation-фолдов нет", async () => {
        // Пять строк без отступов — indentation folding не даёт ни одной области.
        const ctrl = open("a\nb\nc\nd\ne");
        expect(starts(ctrl)).toEqual([]);

        // Регистрация провайдера сама пересчитывает области открытого документа.
        providers.register("*", providerOf([{ startLine: 0, endLine: 3, isCollapsed: false }]));
        await flush();

        expect(starts(ctrl)).toEqual([0]);
        expect(ctrl.viewState.foldedRegions.find((r) => r.startLine === 0)?.endLine).toBe(3);
    });

    it("union: provider ∪ indentation (обе области сохраняются)", async () => {
        // Indentation-область 0..2 (header + два отступа); provider добавляет 3..4.
        const ctrl = open("header\n  x\n  y\nfooter\nmore");
        expect(starts(ctrl)).toEqual([0]);

        providers.register("*", providerOf([{ startLine: 3, endLine: 4, isCollapsed: false }]));
        await flush();

        expect(starts(ctrl)).toEqual([0, 3]);
    });

    it("provider выигрывает по общей startLine", async () => {
        // Indentation даёт 0..2; provider отдаёт 0..3 на той же строке → берём 0..3.
        const ctrl = open("header\n  x\n  y\nfooter");
        expect(ctrl.viewState.foldedRegions.find((r) => r.startLine === 0)?.endLine).toBe(2);

        providers.register("*", providerOf([{ startLine: 0, endLine: 3, isCollapsed: false }]));
        await flush();

        expect(ctrl.viewState.foldedRegions.find((r) => r.startLine === 0)?.endLine).toBe(3);
    });

    it("collapsed переносится через provider-мерж по startLine", async () => {
        const ctrl = open("a\nb\nc\nd\ne");
        providers.register("*", providerOf([{ startLine: 0, endLine: 3, isCollapsed: false }]));
        await flush();

        ctrl.viewState.foldRegionContaining(0); // пользователь свернул
        expect(ctrl.viewState.foldedRegions.find((r) => r.startLine === 0)?.isCollapsed).toBe(true);

        // Второй провайдер перезапускает мерж — свёрнутость обязана уцелеть.
        providers.register("*", providerOf([{ startLine: 0, endLine: 3, isCollapsed: false }]));
        await flush();
        expect(ctrl.viewState.foldedRegions.find((r) => r.startLine === 0)?.isCollapsed).toBe(true);
    });

    it("провайдер упал/таймаут → остаются indentation-фолды (без throw)", async () => {
        const ctrl = open("header\n  x\n  y\nfooter");
        expect(starts(ctrl)).toEqual([0]);

        providers.register("*", {
            provideFoldingRanges: async () => {
                throw new Error("provider boom");
            },
        });
        await flush();

        expect(starts(ctrl)).toEqual([0]); // indentation-фолды уцелели
    });

    it("провайдер чужого языка не спрашивается: области не подъезжают", async () => {
        const ctrl = open("a\nb\nc\nd\ne");
        let asked = false;
        providers.register("typescript", {
            provideFoldingRanges: () => {
                asked = true;
                return Promise.resolve([{ startLine: 0, endLine: 3, isCollapsed: false }]);
            },
        });
        await flush();

        expect(asked).toBe(false);
        expect(starts(ctrl)).toEqual([]);
    });

    it("снятие провайдера пересчитывает области: его регионы уходят", async () => {
        const ctrl = open("a\nb\nc\nd\ne");
        const registration = providers.register("*", providerOf([{ startLine: 0, endLine: 3, isCollapsed: false }]));
        await flush();
        expect(starts(ctrl)).toEqual([0]);

        registration.dispose();
        await flush();

        expect(starts(ctrl)).toEqual([]);
    });

    it("запоздавший ответ снятого провайдера не возвращает его области", async () => {
        const ctrl = open("a\nb\nc\nd\ne");
        let answer: (regions: IFoldingRegion[]) => void = () => undefined;
        const registration = providers.register("*", {
            provideFoldingRanges: () =>
                new Promise((resolve) => {
                    answer = resolve;
                }),
        });
        await flush();

        registration.dispose();
        answer([{ startLine: 0, endLine: 3, isCollapsed: false }]);
        await flush();

        expect(starts(ctrl)).toEqual([]);
    });

    it("пустой ответ провайдера → остаются только indentation-фолды", async () => {
        const ctrl = open("header\n  x\n  y\nfooter");
        expect(starts(ctrl)).toEqual([0]);

        providers.register("*", providerOf([]));
        await flush();

        expect(starts(ctrl)).toEqual([0]); // indentation не потерян
    });

    it("ответ, пришедший после закрытия редактора, не применяется", async () => {
        const ctrl = open("a\nb\nc\nd\ne");
        let resolve: (regions: IFoldingRegion[]) => void = () => undefined;
        providers.register("*", {
            provideFoldingRanges: () =>
                new Promise((r) => {
                    resolve = r;
                }),
        });

        await flush();
        ctrl.component.dispose();
        resolve([{ startLine: 0, endLine: 3, isCollapsed: false }]);
        await flush();

        expect(starts(ctrl)).toEqual([]);
    });

    it("закрытие редактора отменяет запрос и у провайдера", async () => {
        const ctrl = open("a\nb\nc\nd\ne");
        const tokens: ICancellationToken[] = [];
        providers.register("*", {
            provideFoldingRanges: (_request, token) => {
                tokens.push(token);
                return new Promise(() => undefined);
            },
        });
        await flush();
        // Ранние пересчёты уже отменены поздними — живой только последний.
        expect(tokens.at(-1)?.isCancellationRequested).toBe(false);

        ctrl.component.dispose();

        expect(tokens.every((token) => token.isCancellationRequested)).toBe(true);
    });

    describe("правка до ответа провайдера", () => {
        // Многострочная сигнатура, как в Java: по отступам «first(» — область
        // только параметров (1..2), а тело — своя область с «) {» (3..4);
        // провайдер отдаёт метод целиком (1..4).
        const source = [
            "class A {",
            "    void first(",
            "        int a",
            "    ) {",
            "        body1();",
            "    }",
            "    void second() {",
            "        body2();",
            "    }",
            "}",
        ].join("\n");
        const methodRegions: IFoldingRegion[] = [
            { startLine: 0, endLine: 8, isCollapsed: false },
            { startLine: 1, endLine: 4, isCollapsed: false },
            { startLine: 6, endLine: 7, isCollapsed: false },
        ];

        /** Отвечает сразу, пока не позван `defer`; после — запросы ждут `answer`. */
        function registerDeferredProvider(): { defer: () => void; answer: (regions: IFoldingRegion[]) => void } {
            const pending: ((regions: IFoldingRegion[]) => void)[] = [];
            let deferred = false;
            providers.register("*", {
                provideFoldingRanges: () => {
                    if (!deferred) return Promise.resolve(methodRegions.map((r) => ({ ...r })));
                    return new Promise((resolve) => pending.push(resolve));
                },
            });
            return {
                defer: () => {
                    deferred = true;
                },
                answer: (regions) => {
                    for (const resolve of pending.splice(0)) resolve(regions.map((r) => ({ ...r })));
                },
            };
        }

        function frame(ctrl: TextEditorPane): string {
            return renderElement(ctrl.component.view, 40, 12, { themeVars: true }).screenToString();
        }

        it("свёрнутый метод с многострочной сигнатурой не разворачивается на нажатие клавиши", async () => {
            const ctrl = open(source);
            const provider = registerDeferredProvider();
            await flush();
            ctrl.viewState.foldRegionContaining(1); // свернули first целиком
            expect(frame(ctrl)).not.toContain("body1");

            provider.defer();
            ctrl.viewState.selections = [createCursorSelection(7, 16)];
            ctrl.viewState.type("!"); // печатаем в развёрнутом second
            await flush();

            // Провайдер ещё думает: тело first обязано оставаться скрытым,
            // иначе текст выше каретки прыгает на каждое нажатие.
            expect(frame(ctrl)).not.toContain("body1");
            expect(frame(ctrl)).toContain("body2();!");

            provider.answer(methodRegions);
            await flush();

            expect(frame(ctrl)).not.toContain("body1");
            expect(ctrl.viewState.foldedRegions.find((r) => r.startLine === 1)).toMatchObject({
                endLine: 4,
                isCollapsed: true,
            });
        });

        it("пустой ответ провайдера после правки → indentation-фолды", async () => {
            const ctrl = open(source);
            const provider = registerDeferredProvider();
            await flush();
            const methodEnd = (): number | undefined =>
                ctrl.viewState.foldedRegions.find((r) => r.startLine === 1)?.endLine;
            expect(methodEnd()).toBe(4); // метод целиком — от провайдера

            provider.defer();
            ctrl.viewState.selections = [createCursorSelection(7, 16)];
            ctrl.viewState.type("!");
            await flush();
            expect(methodEnd()).toBe(4); // до ответа — прежние области

            provider.answer([]);
            await flush();

            expect(methodEnd()).toBe(2); // провайдеру нечего сказать — стоят отступы
        });
    });
});
