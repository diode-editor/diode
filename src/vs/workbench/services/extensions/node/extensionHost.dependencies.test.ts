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
 * The `requiresDependency.cjs` fixture throws if, when its `activate()` starts, the dependency
 * is not active or has no `exports`, so "the dependent is active"
 * proves the ordering, not a coincidence.
 */

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

/** Its own event never fires; only the dependent can activate it. */
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
    vi.unstubAllEnvs();
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

/** Call BEFORE `start`: the subprocess inherits env when the harness starts. */
function markerFile(name: string): string {
    const marker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "diode-deps-")), "marker");
    vi.stubEnv(name, marker);
    restoreEnv.push(() => {
        fs.rmSync(path.dirname(marker), { recursive: true, force: true });
    });
    return marker;
}

function errorMessages(logger: LoggerSpy): string[] {
    return logger.error.mock.calls.map((call) => String(call[0]));
}

describe("ExtensionHost — extensionDependencies activate first", () => {
    it("the dependent pulls in a dependency whose event never fired and sees its exports (case-insensitive id)", async () => {
        const { harness, toasts } = await start([dependent(["Test.Dep"]), dependency()]);

        await harness.host.activateByEvent("onLanguage:java");

        expect(harness.host.hasExtension("test.dep")).toBe(true);
        expect(harness.host.hasExtension("test.dependent")).toBe(true);
        expect(toasts).toEqual([]);
    });

    it.each([
        ["dependent registered first", true],
        ["dependency registered first", false],
    ])(
        "both match one event (%s): the dependency activates earlier, not in parallel",
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

    it("an already active dependency is not activated twice, and the dependent activates", async () => {
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

    it("the log shows whose dependency it is and which event activated it", async () => {
        const { harness, logger } = await start([dependent(["test.dep"]), dependency()]);

        await harness.host.activateByEvent("onLanguage:java");

        expect(logger.info).toHaveBeenCalledWith(
            'activated extension "test.dep" (dependency of test.dependent, onLanguage:java)',
        );
    });

    it("unknown dependency: the dependent does not activate, the reason goes to the log and an error toast", async () => {
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

    it("each host toast has its own negative handle (no overlap with the subprocess's show*Message)", async () => {
        const second: IExtensionRegistration = {
            ...extensionFixture("test.second", "noopExtension.cjs"),
            manifest: { name: "second", publisher: "test", version: "1.0.0", extensionDependencies: ["x.other"] },
            activationEvents: ["onLanguage:java"],
        };
        const { harness, toasts } = await start([dependent(["x.missing"], "noopExtension.cjs"), second]);

        await harness.host.activateByEvent("onLanguage:java");

        expect(toasts.map((toast) => toast.handle).sort()).toEqual([-1, -2]);
    });

    it("a message sink failure does not crash activation: it goes to the log", async () => {
        const { harness, logger } = await start([dependent(["x.missing"], "noopExtension.cjs")], {
            notificationSink: {
                showMessage: () => Promise.reject(new Error("surface is gone")),
                cancel: () => undefined,
            },
        });

        await harness.host.activateByEvent("onLanguage:java");
        await expect.poll(() => errorMessages(logger)).toContain("showMessage failed: Error: surface is gone");
    });

    it("without a message sink an unknown dependency is only logged, and activation does not fail", async () => {
        const { harness, logger } = await start([dependent(["x.missing"], "noopExtension.cjs")], {
            notificationSink: undefined,
        });

        await harness.host.activateByEvent("onLanguage:java");

        expect(harness.host.hasExtension("test.dependent")).toBe(false);
        expect(errorMessages(logger)).toEqual([
            "Cannot activate the 'test.dependent' extension because it depends on unknown extension 'x.missing'",
        ]);
    });

    it("a VS Code built-in extension (vscode.git) is missing, so we fall back: the dependent activates without it and logs a warning", async () => {
        // Like the stock Supermaven: Diode's git is `diode.git`.
        const { harness, logger, toasts } = await start([dependent(["vscode.git"], "noopExtension.cjs")]);

        await harness.host.activateByEvent("onLanguage:java");

        expect(harness.host.hasExtension("test.dependent")).toBe(true);
        expect(logger.warn).toHaveBeenCalledWith(
            '"test.dependent" depends on built-in VS Code extension "vscode.git", which Diode does not ship — activating without it',
        );
        expect(errorMessages(logger)).toEqual([]);
        expect(toasts).toEqual([]);
    });

    it("a declarative dependency (installed, but without code) is satisfied immediately", async () => {
        const { harness, logger, toasts } = await start([dependent(["Test.Grammar"], "noopExtension.cjs")]);
        harness.host.registerDeclarativeExtension("test.grammar");

        await harness.host.activateByEvent("onLanguage:java");

        expect(harness.host.hasExtension("test.dependent")).toBe(true);
        expect(errorMessages(logger)).toEqual([]);
        expect(toasts).toEqual([]);
    });

    it("a failed dependency: the dependent does not activate, the reason is logged, no toast", async () => {
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

    it("a dependency that failed earlier also keeps the dependent from activating", async () => {
        const dep = { ...dependency("throwsOnActivate.cjs"), activationEvents: ["onLanguage:dep"] };
        const { harness, logger } = await start([dep, dependent(["test.dep"])]);
        await harness.host.activateByEvent("onLanguage:dep");

        await harness.host.activateByEvent("onLanguage:java");

        expect(harness.host.hasExtension("test.dependent")).toBe(false);
        expect(errorMessages(logger)).toContain(
            "Cannot activate the 'test.dependent' extension because its dependency 'test.dep' failed to activate",
        );
    });

    it("dependency cycle: the members do not activate, the cycle is named in the log", async () => {
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

    it("the host shuts down while the dependency activates: the dependent is dropped quietly instead of waiting for a restart", async () => {
        const marker = markerFile("DIODE_TEST_HANG_MARKER");
        const { harness, logger } = await start([dependent(["test.dep"]), dependency("hangsOnActivate.cjs")]);

        const activation = harness.host.activateByEvent("onLanguage:java");
        // Under Stryker instrumentation the subprocess takes longer than the default one-second poll.
        await expect.poll(() => fs.existsSync(marker), { timeout: 10_000 }).toBe(true);
        harness.host.dispose();
        await activation;

        expect(harness.host.hasExtension("test.dependent")).toBe(false);
        expect(logger.warn).not.toHaveBeenCalledWith(
            'activation of "test.dependent" interrupted by extension host death — will retry',
        );
        expect(errorMessages(logger).filter((line) => line.startsWith("Cannot activate"))).toEqual([]);
    });

    it("subprocess death during dependency activation: the dependent is not considered failed and comes back with it", async () => {
        const marker = markerFile("DIODE_TEST_EXIT_MARKER");
        const { harness, logger } = await start([dependent(["test.dep"]), dependency("exitsOnFirstActivate.cjs")]);

        await harness.host.activateByEvent("onLanguage:java");
        expect(fs.existsSync(marker)).toBe(true);
        expect(harness.host.hasExtension("test.dependent")).toBe(false);
        expect(logger.warn).toHaveBeenCalledWith(
            'activation of "test.dependent" interrupted by extension host death — will retry',
        );

        // Any later event replays the journal: onLanguage:java activates the dependent again.
        await harness.host.activateByEvent("onLanguage:anything");

        expect(harness.host.hasExtension("test.dep")).toBe(true);
        expect(harness.host.hasExtension("test.dependent")).toBe(true);
        expect(errorMessages(logger).filter((line) => line.startsWith("Cannot activate"))).toEqual([]);
    });
});
