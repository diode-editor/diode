import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
    type IExtensionHarnessOptions,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { createLoggerSpy, type LoggerSpy } from "../../../../../TestUtils/themeExtensionFixture.ts";
import type { INotificationRequest } from "../../../api/common/iExtensionWindowSinks.ts";

import type { IExtensionRegistration } from "./iExtensionEntry.ts";

/**
 * `extensionDependencies` на настоящем субпроцессе: зависимость поднимается ДО
 * зависимого (как `_handleActivationRequest` эталона), даже если её
 * собственные события не наступали. Фикстура `requiresDependency.cjs` бросает,
 * если зависимость к началу её `activate()` не активна или без `exports`, так
 * что «зависимый активен» доказывает порядок, а не совпадение. Неудовлетворённая
 * зависимость — зависимый не поднимается: причина в лог, а неизвестная
 * зависимость ещё и тостом (`unknownDep` эталона).
 */

/** Зависимое расширение: поднимается по `onLanguage:java` и требует `deps`. */
function dependent(
    deps: readonly string[],
    file = "requiresDependency.cjs",
    extra: Record<string, unknown> = {},
): IExtensionRegistration {
    return {
        ...extensionFixture("test.dependent", file),
        manifest: { name: "dependent", publisher: "test", version: "1.0.0", extensionDependencies: deps, ...extra },
        activationEvents: ["onLanguage:java"],
    };
}

/** Зависимость `test.dep`: своё событие никогда не наступает — поднять её может только зависимый. */
function dependency(file = "exportsMarker.cjs", extra: Record<string, unknown> = {}): IExtensionRegistration {
    return {
        ...extensionFixture("test.dep", file),
        manifest: { name: "dep", publisher: "test", version: "1.0.0", ...extra },
        activationEvents: ["onLanguage:never"],
    };
}

const harnesses: IExtensionHarness[] = [];
const restoreEnv: (() => void)[] = [];

afterEach(async () => {
    for (const harness of harnesses.splice(0)) await harness.dispose();
    for (const restore of restoreEnv.splice(0)) restore();
});

async function start(
    extensions: readonly IExtensionRegistration[],
    options: Partial<IExtensionHarnessOptions> = {},
): Promise<{ harness: IExtensionHarness; logger: LoggerSpy; toasts: INotificationRequest[] }> {
    const logger = createLoggerSpy();
    const toasts: INotificationRequest[] = [];
    const harness = await createExtensionTestHarness({
        activateEvents: [],
        extensions,
        logger,
        notificationSink: {
            showMessage: (request) => {
                toasts.push(request);
                return Promise.resolve(undefined);
            },
            cancel: () => undefined,
        },
        ...options,
    });
    harnesses.push(harness);
    return { harness, logger, toasts };
}

function errorMessages(logger: LoggerSpy): string[] {
    return logger.error.mock.calls.map((call) => String(call[0]));
}

describe("ExtensionHost — extensionDependencies активируются первыми", () => {
    it("зависимый тянет за собой зависимость, чьё событие не наступало, и видит её exports (id без учёта регистра)", async () => {
        const { harness, toasts } = await start([dependent(["Test.Dep"]), dependency()]);

        await harness.host.activateByEvent("onLanguage:java");

        // Зависимый активен — значит, его activate() застал зависимость активной
        // и с exports (иначе фикстура бросает).
        expect(harness.host.hasExtension("test.dep")).toBe(true);
        expect(harness.host.hasExtension("test.dependent")).toBe(true);
        expect(toasts).toEqual([]);
    });

    it.each([
        ["зависимый зарегистрирован первым", true],
        ["зависимость зарегистрирована первой", false],
    ])(
        "оба подходят одному событию (%s): зависимость поднимается раньше, а не параллельно",
        async (_title, dependentFirst) => {
            const dep = { ...dependency(), activationEvents: ["onLanguage:java"] };
            const { harness } = await start(
                dependentFirst ? [dependent(["test.dep"]), dep] : [dep, dependent(["test.dep"])],
            );

            await harness.host.activateByEvent("onLanguage:java");

            expect(harness.host.hasExtension("test.dep")).toBe(true);
            expect(harness.host.hasExtension("test.dependent")).toBe(true);
        },
    );

    it("уже активная зависимость не поднимается второй раз, зависимый встаёт", async () => {
        const dep = { ...dependency(), activationEvents: ["onLanguage:dep"] };
        const { harness, logger } = await start([dep, dependent(["test.dep"])]);
        await harness.host.activateByEvent("onLanguage:dep");

        await harness.host.activateByEvent("onLanguage:java");

        expect(harness.host.hasExtension("test.dependent")).toBe(true);
        const activations = vi.mocked(logger.info).mock.calls.map(([line]) => line);
        expect(activations.filter((line) => line.startsWith('activated extension "test.dep"'))).toEqual([
            'activated extension "test.dep" (onLanguage:dep)',
        ]);
    });

    it("в логе видно, чьей зависимостью и по какому событию поднялась зависимость", async () => {
        const { harness, logger } = await start([dependent(["test.dep"]), dependency()]);

        await harness.host.activateByEvent("onLanguage:java");

        expect(logger.info).toHaveBeenCalledWith(
            'activated extension "test.dep" (dependency of test.dependent, onLanguage:java)',
        );
    });

    it("неизвестная зависимость: зависимый не активируется, причина в лог и тостом ошибки", async () => {
        const { harness, logger, toasts } = await start([
            dependent(["x.missing"], "noopExtension.cjs", { displayName: "Bazel Java" }),
        ]);

        await harness.host.activateByEvent("onLanguage:java");

        const message =
            "Cannot activate the 'Bazel Java' extension because it depends on unknown extension 'x.missing'";
        expect(harness.host.hasExtension("test.dependent")).toBe(false);
        expect(errorMessages(logger)).toEqual([message]);
        expect(toasts).toEqual([{ severity: "error", message, modal: false, items: [], handle: -1 }]);
    });

    it("каждый тост хоста — со своим отрицательным адресом (не пересекается с show*Message субпроцесса)", async () => {
        const second: IExtensionRegistration = {
            ...extensionFixture("test.second", "noopExtension.cjs"),
            manifest: { name: "second", publisher: "test", version: "1.0.0", extensionDependencies: ["x.other"] },
            activationEvents: ["onLanguage:java"],
        };
        const { harness, toasts } = await start([dependent(["x.missing"], "noopExtension.cjs"), second]);

        await harness.host.activateByEvent("onLanguage:java");

        expect(toasts.map((toast) => toast.handle).sort()).toEqual([-1, -2]);
    });

    it("отказ стока сообщений не роняет активацию — он уходит в лог", async () => {
        const { harness, logger } = await start([dependent(["x.missing"], "noopExtension.cjs")], {
            notificationSink: {
                showMessage: () => Promise.reject(new Error("surface is gone")),
                cancel: () => undefined,
            },
        });

        await harness.host.activateByEvent("onLanguage:java");
        await expect.poll(() => errorMessages(logger)).toContain("showMessage failed: Error: surface is gone");
    });

    it("без стока сообщений неизвестная зависимость — только лог, активация не падает", async () => {
        const { harness, logger } = await start([dependent(["x.missing"], "noopExtension.cjs")], {
            notificationSink: undefined,
        });

        await harness.host.activateByEvent("onLanguage:java");

        expect(harness.host.hasExtension("test.dependent")).toBe(false);
        expect(errorMessages(logger)).toEqual([
            "Cannot activate the 'test.dependent' extension because it depends on unknown extension 'x.missing'",
        ]);
    });

    it("декларативная зависимость (установлена, но без кода) удовлетворена сразу", async () => {
        const { harness, logger, toasts } = await start([dependent(["Test.Grammar"], "noopExtension.cjs")]);
        harness.host.registerDeclarativeExtension("test.grammar");

        await harness.host.activateByEvent("onLanguage:java");

        expect(harness.host.hasExtension("test.dependent")).toBe(true);
        expect(errorMessages(logger)).toEqual([]);
        expect(toasts).toEqual([]);
    });

    it("упавшая зависимость: зависимый не активируется, причина в лог, без тоста", async () => {
        const { harness, logger, toasts } = await start([
            dependent(["test.dep"]),
            dependency("throwsOnActivate.cjs", { displayName: "Dep Display" }),
        ]);

        await harness.host.activateByEvent("onLanguage:java");

        expect(harness.host.hasExtension("test.dep")).toBe(false);
        expect(harness.host.hasExtension("test.dependent")).toBe(false);
        expect(errorMessages(logger)).toContain(
            "Cannot activate the 'test.dependent' extension because its dependency 'Dep Display' failed to activate",
        );
        expect(toasts).toEqual([]);
    });

    it("зависимость, упавшая раньше, тоже не даёт подняться зависимому", async () => {
        const dep = { ...dependency("throwsOnActivate.cjs"), activationEvents: ["onLanguage:dep"] };
        const { harness, logger } = await start([dep, dependent(["test.dep"])]);
        await harness.host.activateByEvent("onLanguage:dep");

        await harness.host.activateByEvent("onLanguage:java");

        expect(harness.host.hasExtension("test.dependent")).toBe(false);
        expect(errorMessages(logger)).toContain(
            "Cannot activate the 'test.dependent' extension because its dependency 'test.dep' failed to activate",
        );
    });

    it("цикл зависимостей: участники не активируются, цикл назван в логе", async () => {
        const a: IExtensionRegistration = {
            ...extensionFixture("test.a", "noopExtension.cjs"),
            manifest: { name: "a", publisher: "test", version: "1.0.0", extensionDependencies: ["test.b"] },
            activationEvents: ["onLanguage:java"],
        };
        const b: IExtensionRegistration = {
            ...extensionFixture("test.b", "noopExtension.cjs"),
            manifest: { name: "b", publisher: "test", version: "1.0.0", extensionDependencies: ["test.a"] },
            activationEvents: ["onLanguage:other"],
        };
        const { harness, logger, toasts } = await start([a, b]);

        await harness.host.activateByEvent("onLanguage:java");
        await harness.host.activateByEvent("onLanguage:other");

        expect(harness.host.hasExtension("test.a")).toBe(false);
        expect(harness.host.hasExtension("test.b")).toBe(false);
        expect(errorMessages(logger)).toEqual([
            "Cannot activate the 'test.a' extension because of a dependency loop: test.a -> test.b -> test.a",
            "Cannot activate the 'test.b' extension because of a dependency loop: test.b -> test.a -> test.b",
        ]);
        expect(toasts).toEqual([]);
    });

    it("смерть субпроцесса на активации зависимости: зависимый не считается упавшим и оживает вместе с ней", async () => {
        const marker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "diode-deps-")), "crashed");
        const previous = process.env.DIODE_TEST_EXIT_MARKER;
        process.env.DIODE_TEST_EXIT_MARKER = marker;
        restoreEnv.push(() => {
            if (previous === undefined) delete process.env.DIODE_TEST_EXIT_MARKER;
            else process.env.DIODE_TEST_EXIT_MARKER = previous;
            fs.rmSync(path.dirname(marker), { recursive: true, force: true });
        });
        const { harness, logger } = await start([dependent(["test.dep"]), dependency("exitsOnFirstActivate.cjs")]);

        await harness.host.activateByEvent("onLanguage:java");
        expect(fs.existsSync(marker)).toBe(true);
        expect(harness.host.hasExtension("test.dependent")).toBe(false);
        expect(logger.warn).toHaveBeenCalledWith(
            'activation of "test.dependent" interrupted by extension host death — will retry',
        );

        // Любое следующее событие проигрывает журнал: onLanguage:java снова
        // поднимает зависимого, а он — зависимость (второй раз она не падает).
        await harness.host.activateByEvent("onLanguage:anything");

        expect(harness.host.hasExtension("test.dep")).toBe(true);
        expect(harness.host.hasExtension("test.dependent")).toBe(true);
        expect(errorMessages(logger).filter((line) => line.startsWith("Cannot activate"))).toEqual([]);
    });
});
