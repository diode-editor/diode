import { describe, expect, it } from "vitest";

import { deactivateExtension, type IDeactivatableExtension } from "./extensionDeactivation.ts";
import { createStderrLogger } from "./stderrLogger.ts";

/** Логгер субпроцесса, пишущий строки stderr в массив. */
function captureLogger(): { lines: string[]; logger: ReturnType<typeof createStderrLogger> } {
    const lines: string[] = [];
    return { lines, logger: createStderrLogger((line) => lines.push(line)) };
}

function extension(
    deactivate: (() => unknown) | undefined,
    subscriptions: { dispose: () => unknown }[],
): IDeactivatableExtension {
    return { id: "pub.ext", mod: deactivate === undefined ? {} : { deactivate }, context: { subscriptions } };
}

describe("deactivateExtension", () => {
    it("deactivate, затем подписки в обратном порядке; список подписок опустошается", async () => {
        const order: string[] = [];
        const subscriptions = [
            { dispose: (): unknown => order.push("first") },
            { dispose: (): unknown => order.push("second") },
        ];
        const { lines, logger } = captureLogger();

        await deactivateExtension(
            extension(async () => {
                await Promise.resolve();
                order.push("deactivate");
            }, subscriptions),
            logger,
        );

        expect(order).toEqual(["deactivate", "second", "first"]);
        expect(subscriptions).toEqual([]);
        expect(lines).toEqual([]);
    });

    it("без deactivate — только подписки", async () => {
        const order: string[] = [];
        const { lines, logger } = captureLogger();
        await deactivateExtension(extension(undefined, [{ dispose: (): unknown => order.push("sub") }]), logger);
        expect(order).toEqual(["sub"]);
        expect(lines).toEqual([]);
    });

    it("сбой deactivate и подписки — warn с id расширения, уборка доходит до конца, наружу не бросает", async () => {
        const deactivateError = new Error("deactivate boom");
        const disposeError = new Error("dispose boom");
        const order: string[] = [];
        const { lines, logger } = captureLogger();

        await deactivateExtension(
            extension(
                () => Promise.reject(deactivateError),
                [
                    { dispose: (): unknown => order.push("survivor") },
                    {
                        dispose: (): never => {
                            throw disposeError;
                        },
                    },
                ],
            ),
            logger,
        );

        expect(order).toEqual(["survivor"]);
        expect(lines).toEqual([
            `[ext-host] [pub.ext] deactivate failed: ${String(deactivateError.stack)}`,
            `[ext-host] [pub.ext] subscription dispose failed: ${String(disposeError.stack)}`,
        ]);
    });

    it("синхронный throw из deactivate — тот же warn", async () => {
        const error = new Error("sync boom");
        const { lines, logger } = captureLogger();
        await deactivateExtension(
            extension(() => {
                throw error;
            }, []),
            logger,
        );
        expect(lines).toEqual([`[ext-host] [pub.ext] deactivate failed: ${String(error.stack)}`]);
    });
});
