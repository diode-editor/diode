import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Container, token } from "./diContainer.ts";
import {
    enableInstantiationTrace,
    getInstantiationTracer,
    InstantiationTracer,
    resetInstantiationTrace,
} from "./instantiationTrace.ts";

describe("InstantiationTracer", () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["performance"] });
    });
    afterEach(() => {
        vi.useRealTimers();
        resetInstantiationTrace();
    });

    it("self — без вложенных созданий, inclusive — с ними; запись по завершении", () => {
        const tracer = new InstantiationTracer();
        const value = tracer.trace("Outer", () => {
            vi.advanceTimersByTime(2);
            tracer.trace("Inner", () => {
                vi.advanceTimersByTime(5);
            });
            vi.advanceTimersByTime(3);
            return 7;
        });

        expect(value).toBe(7);
        const [inner, outer] = tracer.getEntries();
        expect(inner).toMatchObject({ id: "Inner", inclusive: 5, self: 5, depth: 1, requester: "Outer" });
        expect(outer).toMatchObject({ id: "Outer", inclusive: 10, self: 5, depth: 0, phase: null });
        expect(inner.start - outer.start).toBe(2);
    });

    it("исключение пробрасывается, записи не остаётся, но время родителю засчитано", () => {
        const tracer = new InstantiationTracer();
        tracer.trace("Outer", () => {
            expect(() =>
                tracer.trace("Broken", () => {
                    vi.advanceTimersByTime(4);
                    throw new Error("boom");
                }),
            ).toThrow("boom");
            vi.advanceTimersByTime(1);
        });

        expect(tracer.getEntries()).toEqual([
            expect.objectContaining({ id: "Outer", inclusive: 5, self: 1, depth: 0 }),
        ]);
    });

    it("создания подряд на верхнем уровне не вкладываются друг в друга", () => {
        const tracer = new InstantiationTracer();
        tracer.trace("First", () => {
            vi.advanceTimersByTime(2);
        });
        tracer.trace("Second", () => {
            vi.advanceTimersByTime(3);
        });

        const [first, second] = tracer.getEntries();
        expect(second).toMatchObject({ id: "Second", depth: 0, inclusive: 3, self: 3 });
        expect(second.requester).not.toBe("First");
        expect(first).toMatchObject({ id: "First", inclusive: 2, self: 2 });
    });

    it("фаза контрибуций метит всё внутри, а флаг — только первое создание верхнего уровня", () => {
        const tracer = new InstantiationTracer();
        const result = tracer.contribution("ready", () =>
            tracer.trace("Contrib", () => {
                tracer.trace("Dep", () => 0);
                return "done";
            }),
        );

        expect(result).toBe("done");
        expect(tracer.getEntries().map((e) => [e.id, e.requester, e.phase, e.contribution])).toEqual([
            ["Dep", "Contrib", "ready", false],
            ["Contrib", "contributions:ready", "ready", true],
        ]);
    });

    it("исключение внутри фазы контрибуций снимает фазу и флаг", () => {
        const tracer = new InstantiationTracer();
        expect(() =>
            tracer.contribution("ready", () => {
                throw new Error("boom");
            }),
        ).toThrow("boom");
        tracer.trace("After", () => 0);

        expect(tracer.getEntries()[0]).toMatchObject({ id: "After", phase: null, contribution: false });
    });

    it("кто запросил на верхнем уровне — функция стека за контейнером", () => {
        enableInstantiationTrace();
        const ValueDIToken = token<number>("Value");
        const container = new Container().bind(ValueDIToken, () => 1);
        function startWorkbenchForTest(): void {
            container.get(ValueDIToken);
        }
        startWorkbenchForTest();

        expect(getInstantiationTracer()?.getEntries()[0].requester).toBe("startWorkbenchForTest");
    });

    it("безымянные функции пропускаются, async-кадр узнаётся по имени", async () => {
        enableInstantiationTrace();
        const ValueDIToken = token<number>("Value");
        const container = new Container().bind(ValueDIToken, () => 1);
        async function openFilesForTest(): Promise<void> {
            await (async () => {
                await Promise.resolve();
                container.get(ValueDIToken);
            })();
        }
        await openFilesForTest();

        expect(getInstantiationTracer()?.getEntries()[0].requester).toBe("openFilesForTest");
    });

    it("стек без именованного вызывателя в пределах лимита кадров — «?»; лимит стека восстановлен", () => {
        const before = Error.stackTraceLimit;
        enableInstantiationTrace();
        const ValueDIToken = token<number>("Value");
        const container = new Container().bind(ValueDIToken, () => 1);
        (() => (() => (() => (() => (() => (() => container.get(ValueDIToken))())())())())())();

        expect(getInstantiationTracer()?.getEntries()[0].requester).toBe("?");
        expect(Error.stackTraceLimit).toBe(before);
    });
});

describe("enableInstantiationTrace / resetInstantiationTrace", () => {
    afterEach(() => {
        resetInstantiationTrace();
    });

    it("по умолчанию выключена; включение идемпотентно; сброс выключает", () => {
        expect(getInstantiationTracer()).toBeUndefined();
        const tracer = enableInstantiationTrace();
        expect(enableInstantiationTrace()).toBe(tracer);
        expect(getInstantiationTracer()).toBe(tracer);
        resetInstantiationTrace();
        expect(getInstantiationTracer()).toBeUndefined();
    });

    it("без трассы контейнер ничего не пишет, с трассой — каждое создание один раз", () => {
        const ValueDIToken = token<number>("Value");
        const OtherDIToken = token<number>("Other");
        const container = new Container().bind(ValueDIToken, () => 1).bind(OtherDIToken, () => 2);
        container.get(ValueDIToken);

        const tracer = enableInstantiationTrace();
        container.get(ValueDIToken);
        container.get(OtherDIToken);
        container.get(OtherDIToken);

        expect(tracer.getEntries().map((e) => e.id)).toEqual(["Other"]);
    });
});
