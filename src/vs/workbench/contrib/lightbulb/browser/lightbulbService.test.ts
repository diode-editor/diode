import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { CodeActionSource, ICodeActionRequest } from "../../../../editor/common/languages/iCodeActionSource.ts";
import type { MarkerService } from "../../../../platform/markers/common/markerService.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";

import { LIGHTBULB_DEBOUNCE_MS, LightbulbService } from "./lightbulbService.ts";

// Лампочка code actions: фоновые запросы с дебаунсом, честное гашение при
// уходе со строки/правке/смене вкладки, отбрасывание устаревших ответов.

interface IFakePane {
    pane: TextEditorPane;
    bulbCalls: (number | null)[];
    moveCaret(line: number, character?: number): void;
    edit(): void;
    setVersion(version: number): void;
}

function makePane(uri: string, text: string): IFakePane {
    const caretListeners: (() => void)[] = [];
    const contentListeners: (() => void)[] = [];
    const bulbCalls: (number | null)[] = [];
    let caret = { line: 0, character: 0 };
    let version = 1;
    const pane = {
        uri: { toString: () => uri },
        languageId: "python",
        getText: () => text,
        viewState: {
            get selections() {
                return [{ anchor: caret, active: caret }];
            },
        },
        model: {
            document: {
                get versionId() {
                    return version;
                },
            },
        },
        onDidChangeCursorPosition: (listener: () => void) => {
            caretListeners.push(listener);
            return { dispose: () => caretListeners.splice(caretListeners.indexOf(listener), 1) };
        },
        onDidChangeContent: (listener: () => void) => {
            contentListeners.push(listener);
            return { dispose: () => contentListeners.splice(contentListeners.indexOf(listener), 1) };
        },
        setLightbulbLine: (line: number | null) => {
            bulbCalls.push(line);
        },
    } as unknown as TextEditorPane;
    return {
        pane,
        bulbCalls,
        moveCaret: (line, character = 0) => {
            caret = { line, character };
            for (const cb of [...caretListeners]) cb();
        },
        edit: () => {
            version += 1;
            for (const cb of [...contentListeners]) cb();
        },
        setVersion: (v) => {
            version = v;
        },
    };
}

interface ISetup {
    service: LightbulbService;
    requests: ICodeActionRequest[];
    fireActiveEditor(pane: TextEditorPane | null): void;
    /** Меняет активный редактор БЕЗ события — гонка «закрылся между тиками». */
    setActiveSilently(pane: TextEditorPane | null): void;
    fireMarkers(resources: string[]): void;
    setSource(source: CodeActionSource | undefined): void;
}

function makeSetup(active: TextEditorPane | null, source: CodeActionSource | undefined): ISetup {
    const requests: ICodeActionRequest[] = [];
    let current = active;
    let currentSource = source;
    const activeListeners: ((pane: TextEditorPane | null) => void)[] = [];
    const markerListeners: ((resources: readonly string[]) => void)[] = [];
    const group = {
        getActiveEditor: () => current,
        get codeActionSource(): CodeActionSource | undefined {
            if (currentSource === undefined) return undefined;
            const inner = currentSource;
            return {
                provide: async (request) => {
                    requests.push(request);
                    return inner.provide(request);
                },
                apply: (id) => inner.apply(id),
            };
        },
        onActiveEditorChanged: (listener: (pane: TextEditorPane | null) => void) => {
            activeListeners.push(listener);
            return { dispose: () => undefined };
        },
    } as unknown as EditorService;
    const markers = {
        onDidChangeMarkers: (listener: (resources: readonly string[]) => void) => {
            markerListeners.push(listener);
            return { dispose: () => undefined };
        },
    } as unknown as MarkerService;
    const service = new LightbulbService(group, markers);
    return {
        service,
        requests,
        fireActiveEditor: (pane) => {
            current = pane;
            for (const cb of [...activeListeners]) cb(pane);
        },
        setActiveSilently: (pane) => {
            current = pane;
        },
        fireMarkers: (resources) => {
            for (const cb of [...markerListeners]) cb(resources);
        },
        setSource: (next) => {
            currentSource = next;
        },
    };
}

const URI = "file:///proj/a.py";

function sourceWith(actions: { id: string; title: string }[] | null): CodeActionSource {
    return { provide: () => Promise.resolve(actions), apply: () => Promise.resolve(true) };
}

async function settleTimers(): Promise<void> {
    await vi.advanceTimersByTimeAsync(LIGHTBULB_DEBOUNCE_MS + 1);
}

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe("LightbulbService", () => {
    it("зажигает лампочку на строке каретки: запрос — полная строка, triggerKind Automatic", async () => {
        const fake = makePane(URI, "import b\nimport a");
        const setup = makeSetup(null, sourceWith([{ id: "1.0", title: "Fix" }]));
        setup.fireActiveEditor(fake.pane);
        fake.moveCaret(1, 3);
        await settleTimers();

        expect(setup.requests).toStrictEqual([
            {
                uri: URI,
                languageId: "python",
                text: "import b\nimport a",
                range: createRange(1, 0, 1, 8),
                triggerKind: 2,
            },
        ]);
        expect(fake.bulbCalls).toEqual([1]);
    });

    it("дебаунс: серия движений по строке — один запрос; пустой ответ гасит", async () => {
        const fake = makePane(URI, "line one");
        const setup = makeSetup(null, sourceWith([]));
        setup.fireActiveEditor(fake.pane);
        fake.moveCaret(0, 1);
        fake.moveCaret(0, 2);
        fake.moveCaret(0, 3);
        await settleTimers();

        expect(setup.requests).toHaveLength(1);
        expect(fake.bulbCalls).toEqual([]); // не горела — гасить нечего

        // null-ответ («нет провайдера») ведёт себя так же тихо.
        setup.setSource(sourceWith(null));
        fake.moveCaret(0, 4);
        await settleTimers();
        expect(fake.bulbCalls).toEqual([]);
    });

    it("уход со строки гасит лампочку сразу, не дожидаясь ответа", async () => {
        const fake = makePane(URI, "one\ntwo");
        const setup = makeSetup(null, sourceWith([{ id: "1.0", title: "Fix" }]));
        setup.fireActiveEditor(fake.pane);
        fake.moveCaret(0);
        await settleTimers();
        expect(fake.bulbCalls).toEqual([0]); // горит на строке 0

        fake.moveCaret(1); // ушли со строки — гаснет немедленно
        expect(fake.bulbCalls).toEqual([0, null]);
        await settleTimers();
        expect(fake.bulbCalls).toEqual([0, null, 1]); // пересчиталась на новой
    });

    it("движение ПО строке не гасит горящую лампочку (гаснет только уход со строки)", async () => {
        const fake = makePane(URI, "alpha beta");
        const setup = makeSetup(null, sourceWith([{ id: "1.0", title: "Fix" }]));
        setup.fireActiveEditor(fake.pane);
        await settleTimers();
        expect(fake.bulbCalls).toEqual([0]);

        fake.moveCaret(0, 5); // та же строка, другая колонка — не мигаем
        expect(fake.bulbCalls).toEqual([0]);
        await settleTimers(); // фоновый пересчёт просто подтверждает показ
        expect(fake.bulbCalls).toEqual([0, 0]);
        expect(setup.requests).toHaveLength(2);
    });

    it("горящую лампочку гасит и пустой, и null-ответ следующего пересчёта", async () => {
        const fake = makePane(URI, "alpha");
        const setup = makeSetup(null, sourceWith([{ id: "1.0", title: "Fix" }]));
        setup.fireActiveEditor(fake.pane);
        await settleTimers();
        expect(fake.bulbCalls).toEqual([0]);

        setup.setSource(sourceWith([]));
        setup.fireMarkers([URI]);
        await settleTimers();
        expect(fake.bulbCalls).toEqual([0, null]);

        // Снова зажгли — и погасили null-ответом («нет провайдера»).
        setup.setSource(sourceWith([{ id: "1.1", title: "Fix" }]));
        setup.fireMarkers([URI]);
        await settleTimers();
        expect(fake.bulbCalls).toEqual([0, null, 0]);
        setup.setSource(sourceWith(null));
        setup.fireMarkers([URI]);
        await settleTimers();
        expect(fake.bulbCalls).toEqual([0, null, 0, null]);
    });

    it("правка гасит сразу и пересчитывает по дебаунсу", async () => {
        const fake = makePane(URI, "solo");
        const setup = makeSetup(null, sourceWith([{ id: "1.0", title: "Fix" }]));
        setup.fireActiveEditor(fake.pane);
        fake.moveCaret(0);
        await settleTimers();
        expect(fake.bulbCalls).toEqual([0]);

        fake.edit();
        expect(fake.bulbCalls).toEqual([0, null]);
        await settleTimers();
        expect(fake.bulbCalls).toEqual([0, null, 0]);
    });

    it("устаревший ответ отброшен: новый запрос обгоняет, версия/строка сверяются", async () => {
        const fake = makePane(URI, "one\ntwo");
        let release: (value: { id: string; title: string }[]) => void = () => undefined;
        const slow: CodeActionSource = {
            provide: () =>
                new Promise((resolve) => {
                    release = resolve;
                }),
            apply: () => Promise.resolve(true),
        };
        const setup = makeSetup(null, slow);
        setup.fireActiveEditor(fake.pane);
        fake.moveCaret(0);
        await settleTimers();
        const staleRelease = release;

        // Пока первый ответ в полёте — каретка ушла и стартовал второй запрос.
        fake.moveCaret(1);
        await settleTimers();
        staleRelease([{ id: "old", title: "stale" }]);
        await vi.advanceTimersByTimeAsync(1);
        expect(fake.bulbCalls).toEqual([]); // устаревший ответ ничего не зажёг

        release([{ id: "new", title: "fresh" }]);
        await vi.advanceTimersByTimeAsync(1);
        expect(fake.bulbCalls).toEqual([1]);

        // Версия документа сменилась за время полёта — ответ отброшен
        // (уход со строки 1 честно погасил горевшую лампочку, но versioned-ответ
        // ничего нового не зажёг).
        fake.moveCaret(0);
        await settleTimers();
        fake.setVersion(99);
        release([{ id: "v", title: "versioned" }]);
        await vi.advanceTimersByTimeAsync(1);
        expect(fake.bulbCalls).toEqual([1, null]);
    });

    it("поздний ответ ТОЙ ЖЕ строки не перетирает свежий (seq-гард без смены строки)", async () => {
        const fake = makePane(URI, "alpha");
        const resolvers: ((value: { id: string; title: string }[]) => void)[] = [];
        const slow: CodeActionSource = {
            provide: () =>
                new Promise((resolve) => {
                    resolvers.push(resolve);
                }),
            apply: () => Promise.resolve(true),
        };
        const setup = makeSetup(null, slow);
        setup.fireActiveEditor(fake.pane);
        await settleTimers(); // запрос №1 в полёте (строка 0)
        setup.fireMarkers([URI]);
        await settleTimers(); // запрос №2 в полёте (та же строка 0)
        expect(resolvers).toHaveLength(2);

        resolvers[1]([{ id: "fresh", title: "Fix" }]); // свежий зажёг
        await vi.advanceTimersByTimeAsync(1);
        expect(fake.bulbCalls).toEqual([0]);

        resolvers[0]([]); // устаревший пустой ответ НЕ гасит свежую лампочку
        await vi.advanceTimersByTimeAsync(1);
        expect(fake.bulbCalls).toEqual([0]);
    });

    it("каретка ушла до прихода ответа (нового запроса ещё нет) — ответ отброшен по строке", async () => {
        const fake = makePane(URI, "one\ntwo");
        let release: (value: { id: string; title: string }[]) => void = () => undefined;
        const slow: CodeActionSource = {
            provide: () =>
                new Promise((resolve) => {
                    release = resolve;
                }),
            apply: () => Promise.resolve(true),
        };
        const setup = makeSetup(null, slow);
        setup.fireActiveEditor(fake.pane);
        await settleTimers(); // запрос строки 0 в полёте

        fake.moveCaret(1); // ушли со строки; дебаунс нового запроса ещё тикает
        release([{ id: "old", title: "stale" }]);
        await vi.advanceTimersByTimeAsync(1);
        expect(fake.bulbCalls).toEqual([]); // на строке 0 ничего не зажглось
    });

    it("активный редактор сменился, пока ответ был в полёте, — старая панель не зажигается", async () => {
        const first = makePane(URI, "alpha");
        const second = makePane("file:///proj/b.py", "beta");
        let release: (value: { id: string; title: string }[]) => void = () => undefined;
        const slow: CodeActionSource = {
            provide: () =>
                new Promise((resolve) => {
                    release = resolve;
                }),
            apply: () => Promise.resolve(true),
        };
        const setup = makeSetup(null, slow);
        setup.fireActiveEditor(first.pane);
        await settleTimers(); // запрос первой панели в полёте

        setup.fireActiveEditor(second.pane); // вкладка сменилась (seq не трогали)
        release([{ id: "old", title: "stale" }]);
        await vi.advanceTimersByTimeAsync(1);
        expect(first.bulbCalls).toEqual([]); // чужой ответ не зажёг старую панель
    });

    it("смена вкладки гасит лампочку старой панели и пересчитывает на новой", async () => {
        const first = makePane(URI, "alpha");
        const second = makePane("file:///proj/b.py", "beta");
        const setup = makeSetup(null, sourceWith([{ id: "1.0", title: "Fix" }]));
        setup.fireActiveEditor(first.pane);
        first.moveCaret(0);
        await settleTimers();
        expect(first.bulbCalls).toEqual([0]);

        setup.fireActiveEditor(second.pane);
        expect(first.bulbCalls).toEqual([0, null]); // старая панель погашена
        await settleTimers();
        expect(second.bulbCalls).toEqual([0]);

        // Подписки старой панели сняты: её каретка больше не порождает запросов.
        const requestsBefore = setup.requests.length;
        first.moveCaret(0, 3);
        await settleTimers();
        expect(setup.requests).toHaveLength(requestsBefore);
    });

    it("маркеры: чужой ресурс игнорируется, свой — пересчитывает; без источника — тихо гаснет", async () => {
        const fake = makePane(URI, "alpha");
        const setup = makeSetup(null, sourceWith([{ id: "1.0", title: "Fix" }]));
        setup.fireActiveEditor(fake.pane);
        await settleTimers();
        expect(fake.bulbCalls).toEqual([0]);

        setup.fireMarkers(["file:///elsewhere.py"]);
        await settleTimers();
        expect(setup.requests).toHaveLength(1); // чужой ресурс не триггерит

        setup.fireMarkers([URI]);
        await settleTimers();
        expect(setup.requests).toHaveLength(2);
        // Повторный показ той же строки — просто ещё один set, без миганий null.
        expect(fake.bulbCalls).toEqual([0, 0]);

        // Источник исчез (субпроцесс умер) — лампочка не врёт, гаснет.
        setup.setSource(undefined);
        setup.fireMarkers([URI]);
        await settleTimers();
        expect(fake.bulbCalls.at(-1)).toBeNull();
    });

    it("каретка за пределами текста — пустой диапазон строки, не падение", async () => {
        const fake = makePane(URI, "solo");
        const setup = makeSetup(null, sourceWith([]));
        setup.fireActiveEditor(fake.pane);
        fake.moveCaret(99);
        await settleTimers();
        expect(setup.requests.at(-1)?.range).toEqual(createRange(99, 0, 99, 0));
    });

    it("сбойный источник не роняет процесс: reject проглатывается, лампочка не врёт", async () => {
        const fake = makePane(URI, "alpha");
        const setup = makeSetup(null, {
            provide: () => Promise.reject(new Error("source boom")),
            apply: () => Promise.resolve(true),
        });
        setup.fireActiveEditor(fake.pane);
        await settleTimers();
        expect(fake.bulbCalls).toEqual([]); // не зажглась и ничего не уронила
    });

    it("редактор исчез между schedule и тиком — лампочка гаснет, не падение", async () => {
        const fake = makePane(URI, "alpha");
        const setup = makeSetup(null, sourceWith([{ id: "1.0", title: "Fix" }]));
        setup.fireActiveEditor(fake.pane);
        await settleTimers();
        expect(fake.bulbCalls).toEqual([0]);

        setup.fireMarkers([URI]); // таймер взведён
        setup.setActiveSilently(null); // редактор пропал без события
        await settleTimers();
        expect(fake.bulbCalls).toEqual([0, null]); // query честно погасил
    });

    it("без активного редактора и после dispose — ни запросов, ни падений", async () => {
        const setup = makeSetup(null, sourceWith([{ id: "1.0", title: "Fix" }]));
        setup.fireMarkers([URI]);
        await settleTimers();
        expect(setup.requests).toEqual([]);

        const fake = makePane(URI, "alpha");
        setup.fireActiveEditor(fake.pane);
        setup.service.dispose();
        fake.moveCaret(0);
        await settleTimers();
        expect(setup.requests).toEqual([]);
    });
});
