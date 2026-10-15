import { describe, expect, it, vi } from "vitest";

import type { Uri } from "../../../../base/common/uri.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { type IStateDescriptor, StateServiceDIToken } from "../../../../platform/state/common/iStateService.ts";
import { type IOpenURLOptions, URLServiceDIToken } from "../../../../platform/url/common/url.ts";
import { type InputBoxOptions, QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";

import { OPEN_URL_LAST_INPUT_STATE, openUrlAction, URL_ACTIONS } from "./urlActions.ts";

function harness(answer: string | undefined, stored: Record<string, unknown> = {}) {
    const state = new Map<string, unknown>(Object.entries(stored));
    const inputs: InputBoxOptions[] = [];
    const opened: { uri: Uri; options?: IOpenURLOptions }[] = [];
    const services = new Map<unknown, unknown>([
        [
            QuickInputServiceDIToken,
            {
                input: (options: InputBoxOptions) => {
                    inputs.push(options);
                    return Promise.resolve(answer);
                },
            },
        ],
        [
            StateServiceDIToken,
            {
                get: <T>(d: IStateDescriptor<T>): T => (state.has(d.key) ? (state.get(d.key) as T) : d.default),
                store: vi.fn(<T>(d: IStateDescriptor<T>, value: T) => {
                    state.set(d.key, value);
                }),
            },
        ],
        [
            URLServiceDIToken,
            {
                open: (uri: Uri, options?: IOpenURLOptions) => {
                    opened.push({ uri, options });
                    return Promise.resolve(true);
                },
            },
        ],
    ]);
    const accessor = {
        get(token: unknown) {
            if (services.has(token)) return services.get(token);
            throw new Error("unexpected token");
        },
    } as unknown as ServiceAccessor;
    return { accessor, state, inputs, opened };
}

describe("Developer: Open URL", () => {
    it("id, заголовок и категория — эталонные; в списке экшенов URL", () => {
        expect(openUrlAction.id).toBe("workbench.action.url.openUrl");
        expect(openUrlAction.title).toBe("Developer: Open URL");
        expect(openUrlAction.shortTitle).toBe("Open URL");
        expect(URL_ACTIONS).toEqual([openUrlAction]);
    });

    it("состояние — эталонный ключ в области воркспейса, пусто по умолчанию", () => {
        expect(OPEN_URL_LAST_INPUT_STATE).toEqual({
            key: "workbench.action.url.openUrl.lastInput",
            scope: "workspace",
            default: "",
        });
    });

    it("ввод открывается через URL-сервис с исходной строкой и запоминается", async () => {
        const raw = "diode://anthropic.claude-code/install-plugin?name=a%20b";
        const h = harness(raw);
        await openUrlAction.run(h.accessor);
        expect(h.inputs).toEqual([{ prompt: "URL to open", value: "" }]);
        expect(h.opened).toHaveLength(1);
        expect(h.opened[0]?.uri.authority).toBe("anthropic.claude-code");
        expect(h.opened[0]?.uri.query).toBe("name=a b");
        expect(h.opened[0]?.options).toEqual({ originalUrl: raw });
        expect(h.state.get("workbench.action.url.openUrl.lastInput")).toBe(raw);
    });

    it("поле предзаполнено прошлым вводом", async () => {
        const h = harness(undefined, { "workbench.action.url.openUrl.lastInput": "diode://a.b/prev" });
        await openUrlAction.run(h.accessor);
        expect(h.inputs[0]?.value).toBe("diode://a.b/prev");
    });

    it.each([undefined, ""])(
        "отмена или пустой ввод — ничего не открывается и не запоминается (%j)",
        async (answer) => {
            const h = harness(answer, { "workbench.action.url.openUrl.lastInput": "diode://a.b/prev" });
            await openUrlAction.run(h.accessor);
            expect(h.opened).toEqual([]);
            expect(h.state.get("workbench.action.url.openUrl.lastInput")).toBe("diode://a.b/prev");
        },
    );
});
