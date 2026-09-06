import { describe, expect, it } from "vitest";

import type { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { NULL_JUMP_RECORDER } from "../../../services/history/browser/historyService.ts";

import type { IReferenceGroup } from "./referencePreview.ts";
import { type IReferencesRevealTarget, ReferencesComponent } from "./referencesComponent.ts";

/** Реестр view не участвует в юнит-тестах компонента — контейнер собирает workbench. */
const NULL_VIEWS_SERVICE = { registerView: () => {} } as unknown as ViewsService;

/** Reveal-цель, записывающая открытия и переходы (аналог фейка Search/Problems). */
function fakeReveal(opts: { noEditor?: boolean } = {}): {
    target: IReferencesRevealTarget;
    opened: string[];
    positions: [number, number | undefined][];
    ranges: IRange[];
} {
    const opened: string[] = [];
    const positions: [number, number | undefined][] = [];
    const ranges: IRange[] = [];
    const target: IReferencesRevealTarget = {
        openUri: (uri) => opened.push(uri.fsPath),
        getActiveEditor: () =>
            opts.noEditor === true
                ? null
                : {
                      goToPosition: (line, column) => positions.push([line, column]),
                      revealRange: (range) => ranges.push(range),
                  },
    };
    return { target, opened, positions, ranges };
}

function group(relPath: string, lines: [number, string, string, string][]): IReferenceGroup {
    return {
        absolutePath: `/work/project/${relPath}`,
        relPath,
        matches: lines.map(([lineNumber, before, inside, after]) => ({
            lineNumber,
            startColumn: before.length,
            endColumn: before.length + inside.length,
            preview: { before, inside, after },
        })),
    };
}

function twoFiles(): IReferenceGroup[] {
    return [
        group("src/a.ts", [
            [1, "export function ", "greet", "() {}"],
            [7, "  return ", "greet", "();"],
        ]),
        group("src/b.ts", [[3, "import { ", "greet", ' } from "./a";']]),
    ];
}

function make(opts: { reveal?: IReferencesRevealTarget; contextKeys?: ContextKeyService } = {}): ReferencesComponent {
    return new ReferencesComponent(
        opts.reveal ?? fakeReveal().target,
        opts.contextKeys ?? new ContextKeyService(),
        NULL_VIEWS_SERVICE,
        NULL_JUMP_RECORDER,
    );
}

function render(component: ReferencesComponent, w = 40, h = 10): MockTerminalBackend {
    return renderElement(component.view, w, h, { themeVars: true });
}

describe("ReferencesComponent — наполнение панели", () => {
    it("группирует ссылки по файлам со счётчиком и строками кода", () => {
        const component = make();
        component.setResults(twoFiles());

        const screen = render(component).screenToString();
        expect(screen).toContain("3 results in 2 files");
        expect(screen).toContain("src/a.ts");
        expect(screen).toContain("export function greet() {}");
        expect(screen).toContain("src/b.ts");
        // Номера строк — рядом с текстом ссылки.
        expect(screen).toContain("7");
        expect(component.resultCount).toBe(3);
        // 2 файла + 3 ссылки.
        expect(component.results.contentHeight).toBe(5);
    });

    it("единственный файл считается в единственном числе", () => {
        const component = make();
        component.setResults([group("a.ts", [[1, "", "greet", ""]])]);
        expect(render(component).screenToString()).toContain("1 results in 1 file");
    });

    it("пустой результат — «No results», а не пустая шапка", () => {
        const component = make();
        component.setResults([]);
        expect(render(component).screenToString()).toContain("No results");
        expect(component.resultCount).toBe(0);
    });

    it("до первого поиска шапка пуста", () => {
        expect(render(make()).screenToString()).not.toContain("results");
    });

    it("новый поиск вытесняет прежние ссылки, а clear() возвращает панель в исходное", () => {
        const component = make();
        component.setResults(twoFiles());
        component.setResults([group("c.ts", [[2, "const ", "other", " = 1;"]])]);

        let screen = render(component).screenToString();
        expect(screen).toContain("1 results in 1 file");
        expect(screen).not.toContain("src/a.ts");

        component.clear();
        screen = render(component).screenToString();
        expect(screen).not.toContain("results");
        expect(screen).not.toContain("c.ts");
        expect(component.results.contentHeight).toBe(0);
        expect(component.resultCount).toBe(0);
    });

    it("курсор встаёт на первую ссылку, а не на строку файла", () => {
        const component = make();
        component.setResults(twoFiles());
        expect(component.results.getCursorElement()?.id).toBe("ref:src/a.ts:0");
    });
});

describe("ReferencesComponent — сворачивание", () => {
    it("Collapse All сворачивает файлы, Expand All возвращает ссылки", () => {
        const component = make();
        component.setResults(twoFiles());
        expect(component.results.contentHeight).toBe(5);

        component.collapseDeepestLevel();
        expect(component.results.contentHeight).toBe(2);
        expect(component.results.isCollapsed("file:src/a.ts")).toBe(true);

        component.expandAll();
        expect(component.results.contentHeight).toBe(5);
        expect(component.results.isCollapsed("file:src/a.ts")).toBe(false);
    });

    it("контекст-ключи следуют за состоянием панели", () => {
        const contextKeys = new ContextKeyService();
        const component = make({ contextKeys });

        expect(contextKeys.get("hasReferenceResult")).toBe(false);
        expect(contextKeys.get("referencesViewHasSomeCollapsibleResult")).toBe(false);

        component.setResults(twoFiles());
        expect(contextKeys.get("hasReferenceResult")).toBe(true);
        expect(contextKeys.get("referencesViewHasSomeCollapsibleResult")).toBe(true);

        component.collapseDeepestLevel();
        expect(contextKeys.get("referencesViewHasSomeCollapsibleResult")).toBe(false);

        component.clear();
        expect(contextKeys.get("hasReferenceResult")).toBe(false);
    });
});

describe("ReferencesComponent — открытие ссылки", () => {
    it("активация ссылки открывает файл на её позиции", () => {
        const reveal = fakeReveal();
        const component = make({ reveal: reveal.target });
        component.setResults(twoFiles());

        component.results.onActivate!({ id: "ref:src/a.ts:1" } as never);

        expect(reveal.opened).toEqual(["/work/project/src/a.ts"]);
        // lineNumber 7 (1-based) → строка 6 редактора; колонки — из превью.
        expect(reveal.positions).toEqual([[6, 9]]);
        expect(reveal.ranges).toEqual([
            { start: { line: 6, character: 9 }, end: { line: 6, character: 14 } },
        ]);
    });

    it("активация строки файла сворачивает её, а не открывает файл", () => {
        const reveal = fakeReveal();
        const component = make({ reveal: reveal.target });
        component.setResults(twoFiles());

        component.results.onActivate!({ id: "file:src/a.ts" } as never);

        expect(reveal.opened).toEqual([]);
        expect(component.results.isCollapsed("file:src/a.ts")).toBe(true);
    });

    it("без активного редактора после openUri позиция не выставляется", () => {
        const reveal = fakeReveal({ noEditor: true });
        const component = make({ reveal: reveal.target });
        component.setResults(twoFiles());

        component.results.onActivate!({ id: "ref:src/a.ts:0" } as never);

        expect(reveal.opened).toEqual(["/work/project/src/a.ts"]);
        expect(reveal.positions).toEqual([]);
    });
});

describe("ReferencesComponent — обход по F4", () => {
    it("идёт по всем файлам подряд и заворачивается с последней на первую", () => {
        const reveal = fakeReveal();
        const component = make({ reveal: reveal.target });
        component.setResults(twoFiles());

        // Курсор стоит на первой ссылке — шаг вперёд ведёт на вторую.
        component.goToNextReference();
        expect(component.results.getCursorElement()?.id).toBe("ref:src/a.ts:1");
        component.goToNextReference();
        expect(component.results.getCursorElement()?.id).toBe("ref:src/b.ts:0");
        // С последней — снова на первую.
        component.goToNextReference();
        expect(component.results.getCursorElement()?.id).toBe("ref:src/a.ts:0");

        // Каждый шаг открывал файл на позиции.
        expect(reveal.opened).toEqual([
            "/work/project/src/a.ts",
            "/work/project/src/b.ts",
            "/work/project/src/a.ts",
        ]);
    });

    it("Shift+F4 с первой ссылки заворачивается на последнюю", () => {
        const component = make();
        component.setResults(twoFiles());

        component.goToPreviousReference();
        expect(component.results.getCursorElement()?.id).toBe("ref:src/b.ts:0");
        component.goToPreviousReference();
        expect(component.results.getCursorElement()?.id).toBe("ref:src/a.ts:1");
    });

    it("свёрнутый файл раскрывается — курсор не уезжает в невидимое", () => {
        const component = make();
        component.setResults(twoFiles());
        // Свернули всё: курсор со ссылки ушёл (её строка скрыта), поэтому шаг
        // вперёд ведёт на первую ссылку и раскрывает её файл.
        component.collapseDeepestLevel();
        expect(component.results.getCursorElement()?.id).not.toBe("ref:src/a.ts:0");

        component.goToNextReference();

        expect(component.results.isCollapsed("file:src/a.ts")).toBe(false);
        expect(component.results.getCursorElement()?.id).toBe("ref:src/a.ts:0");

        // Дальше обход идёт как обычно, раскрывая следующий свёрнутый файл.
        component.goToNextReference();
        component.goToNextReference();
        expect(component.results.getCursorElement()?.id).toBe("ref:src/b.ts:0");
        expect(component.results.isCollapsed("file:src/b.ts")).toBe(false);
    });

    it("курсор на строке файла: вперёд — на первую ссылку, назад — на последнюю", () => {
        const forward = make();
        forward.setResults(twoFiles());
        forward.results.setCursorTo("file:src/b.ts");
        forward.goToNextReference();
        expect(forward.results.getCursorElement()?.id).toBe("ref:src/a.ts:0");

        const backward = make();
        backward.setResults(twoFiles());
        backward.results.setCursorTo("file:src/b.ts");
        backward.goToPreviousReference();
        expect(backward.results.getCursorElement()?.id).toBe("ref:src/b.ts:0");
    });

    it("на пустой панели обход — no-op", () => {
        const reveal = fakeReveal();
        const component = make({ reveal: reveal.target });

        component.goToNextReference();
        component.goToPreviousReference();

        expect(reveal.opened).toEqual([]);
    });
});
