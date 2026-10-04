import { describe, expect, it, vi } from "vitest";

import { CancellationTokenSource } from "../../../base/common/cancellation.ts";
import { Uri } from "../../../base/common/uri.ts";
import { createRange } from "../../common/core/iRange.ts";
import { LanguageFeatureRegistry } from "../../common/languageFeatureRegistry.ts";
import type {
    CodeActionProvider,
    ICodeActionRequest,
    ICoreCodeAction,
} from "../../common/languages/iCodeActionSource.ts";

import { codeActionKindsIntersect, getCodeActions } from "./codeAction.ts";

const PY = { uri: Uri.file("/w/a.py"), languageId: "python" };
const REQUEST: ICodeActionRequest = {
    uri: PY.uri.toString(),
    languageId: "python",
    versionId: 1,
    range: createRange(0, 0, 0, 9),
};

const TOKEN = new CancellationTokenSource().token;

function provider(
    actions: readonly ICoreCodeAction[],
    providedCodeActionKinds: readonly string[] = [],
): CodeActionProvider {
    return {
        providedCodeActionKinds,
        provideCodeActions: vi.fn(() => Promise.resolve(actions)),
        applyCodeAction: () => Promise.resolve(true),
    };
}

describe("codeActionKindsIntersect", () => {
    it("равные и вложенные по точке — пересекаются, соседи и префиксы без точки — нет", () => {
        expect(codeActionKindsIntersect("source", "source")).toBe(true);
        expect(codeActionKindsIntersect("source", "source.fixAll.ruff")).toBe(true);
        expect(codeActionKindsIntersect("source.fixAll.ruff", "source")).toBe(true);
        expect(codeActionKindsIntersect("source.fixAll", "source.organizeImports")).toBe(false);
        expect(codeActionKindsIntersect("quick", "quickfix")).toBe(false);
        expect(codeActionKindsIntersect("quickfix", "quick")).toBe(false);
    });
});

describe("getCodeActions", () => {
    it("склеивает действия в порядке реестра и помнит владельца", async () => {
        const registry = new LanguageFeatureRegistry<CodeActionProvider>();
        const any = provider([{ id: "1.0", title: "any" }]);
        const exact = provider([{ id: "2.0", title: "exact" }]);
        registry.register("*", any);
        registry.register("python", exact);

        const items = await getCodeActions(registry, PY, REQUEST, TOKEN);

        expect(items.map((item) => item.action.title)).toEqual(["exact", "any"]);
        expect(items[0].provider).toBe(exact);
        expect(items[1].provider).toBe(any);
        // Токен запроса — каждому спрошенному провайдеру.
        expect(exact.provideCodeActions).toHaveBeenCalledWith(REQUEST, TOKEN);
        expect(any.provideCodeActions).toHaveBeenCalledWith(REQUEST, TOKEN);
    });

    it("провайдер, чьи виды не пересекаются с only, не спрашивается; без видов — спрашивается всегда", async () => {
        const registry = new LanguageFeatureRegistry<CodeActionProvider>();
        const organize = provider([{ id: "1.0", title: "Sort" }], ["source.organizeImports"]);
        const anyKind = provider([{ id: "2.0", title: "Any" }]);
        registry.register("python", organize);
        registry.register("python", anyKind);

        const fixAll = await getCodeActions(registry, PY, { ...REQUEST, only: "source.fixAll" }, TOKEN);
        expect(fixAll.map((item) => item.action.title)).toEqual(["Any"]);
        expect(organize.provideCodeActions).not.toHaveBeenCalled();

        const source = await getCodeActions(registry, PY, { ...REQUEST, only: "source" }, TOKEN);
        expect(source.map((item) => item.action.title)).toEqual(["Any", "Sort"]);

        // Без only виды не участвуют.
        await getCodeActions(registry, PY, REQUEST, TOKEN);
        expect(organize.provideCodeActions).toHaveBeenCalledTimes(2);
    });

    it("сбойный провайдер = «действий нет», остальные доезжают", async () => {
        const registry = new LanguageFeatureRegistry<CodeActionProvider>();
        registry.register("python", provider([{ id: "1.0", title: "ok" }]));
        registry.register("python", {
            providedCodeActionKinds: [],
            provideCodeActions: () => Promise.reject(new Error("boom")),
            applyCodeAction: () => Promise.resolve(false),
        });

        const items = await getCodeActions(registry, PY, REQUEST, TOKEN);
        expect(items.map((item) => item.action.title)).toEqual(["ok"]);
    });
});
