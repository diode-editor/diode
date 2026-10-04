import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import { LanguageFeatureRegistry } from "../../../../editor/common/languageFeatureRegistry.ts";
import type {
    ICoreRenameLocation,
    ICoreRenameResult,
    IRenameRequest,
    RenameProvider,
} from "../../../../editor/common/languages/iRenameSource.ts";

import { prepareRename, renameSymbol } from "./renameSymbol.ts";

const TS = { uri: Uri.file("/w/a.ts"), languageId: "typescript" };
const REQUEST: IRenameRequest = {
    uri: TS.uri.toString(),
    languageId: "typescript",
    text: "const value = 1;\n",
    line: 0,
    character: 8,
};

function provider(impl: Partial<RenameProvider>): RenameProvider {
    return {
        prepareRename: impl.prepareRename ?? ((): Promise<null> => Promise.resolve(null)),
        provideRenameEdits:
            impl.provideRenameEdits ?? ((): Promise<ICoreRenameResult> => Promise.resolve({ applied: false })),
    };
}

const named = (value: string): Promise<ICoreRenameLocation> => Promise.resolve({ kind: "name", name: value });

describe("prepareRename", () => {
    it("имя даёт ПЕРВЫЙ провайдер, которому есть что сказать", async () => {
        const registry = new LanguageFeatureRegistry<RenameProvider>();
        const second = vi.fn(() => named("second"));
        // Порядок `ordered` — новые первыми при равном score, поэтому
        // «первым» спросят зарегистрированного последним.
        registry.register({ language: "typescript" }, provider({ prepareRename: second }));
        registry.register({ language: "typescript" }, provider({ prepareRename: () => named("first") }));

        expect(await prepareRename(registry, TS, REQUEST)).toEqual({ name: "first" });
        expect(second).not.toHaveBeenCalled();
    });

    it("провайдер без ответа пропускается — спрашиваем следующего", async () => {
        const registry = new LanguageFeatureRegistry<RenameProvider>();
        registry.register({ language: "typescript" }, provider({ prepareRename: () => named("second") }));
        registry.register({ language: "typescript" }, provider({}));

        expect(await prepareRename(registry, TS, REQUEST)).toEqual({ name: "second" });
    });

    it("отказ провайдера останавливает перебор и едет причиной", async () => {
        const registry = new LanguageFeatureRegistry<RenameProvider>();
        const second = vi.fn(() => named("second"));
        registry.register({ language: "typescript" }, provider({ prepareRename: second }));
        registry.register(
            { language: "typescript" },
            provider({ prepareRename: () => Promise.resolve({ kind: "reject", reason: "no identifier" }) }),
        );

        expect(await prepareRename(registry, TS, REQUEST)).toEqual({ name: null, rejectReason: "no identifier" });
        expect(second).not.toHaveBeenCalled();
    });

    it("сбойный провайдер не роняет перебор: его ответ — «сказать нечего»", async () => {
        const registry = new LanguageFeatureRegistry<RenameProvider>();
        registry.register({ language: "typescript" }, provider({ prepareRename: () => named("second") }));
        registry.register(
            { language: "typescript" },
            provider({ prepareRename: () => Promise.reject(new Error("rpc died")) }),
        );

        expect(await prepareRename(registry, TS, REQUEST)).toEqual({ name: "second" });
    });

    it("провайдер чужого языка не спрашивается, пустой реестр — без имени", async () => {
        const registry = new LanguageFeatureRegistry<RenameProvider>();
        const alien = vi.fn(() => named("alien"));
        registry.register({ language: "python" }, provider({ prepareRename: alien }));

        expect(await prepareRename(registry, TS, REQUEST)).toEqual({ name: null });
        expect(alien).not.toHaveBeenCalled();
    });
});

describe("renameSymbol", () => {
    it("переименовывает ПЕРВЫЙ провайдер, давший правки; новое имя доезжает", async () => {
        const registry = new LanguageFeatureRegistry<RenameProvider>();
        const second = vi.fn((): Promise<ICoreRenameResult> => Promise.resolve({ applied: true }));
        const first = vi.fn((): Promise<ICoreRenameResult> => Promise.resolve({ applied: true }));
        registry.register({ language: "typescript" }, provider({ provideRenameEdits: second }));
        registry.register({ language: "typescript" }, provider({ provideRenameEdits: first }));

        expect(await renameSymbol(registry, TS, REQUEST, "renamed")).toEqual({ applied: true });
        expect(first).toHaveBeenCalledWith(REQUEST, "renamed");
        expect(second).not.toHaveBeenCalled();
    });

    it("провайдер без правок пропускается — спрашиваем следующего", async () => {
        const registry = new LanguageFeatureRegistry<RenameProvider>();
        registry.register(
            { language: "typescript" },
            provider({ provideRenameEdits: () => Promise.resolve({ applied: true }) }),
        );
        registry.register({ language: "typescript" }, provider({}));

        expect(await renameSymbol(registry, TS, REQUEST, "renamed")).toEqual({ applied: true });
    });

    it("отказ провайдера останавливает перебор: сообщение едет человеку", async () => {
        const registry = new LanguageFeatureRegistry<RenameProvider>();
        const second = vi.fn((): Promise<ICoreRenameResult> => Promise.resolve({ applied: true }));
        registry.register({ language: "typescript" }, provider({ provideRenameEdits: second }));
        registry.register(
            { language: "typescript" },
            provider({ provideRenameEdits: () => Promise.resolve({ applied: false, error: "Invalid name" }) }),
        );

        expect(await renameSymbol(registry, TS, REQUEST, "class")).toEqual({
            applied: false,
            error: "Invalid name",
        });
        expect(second).not.toHaveBeenCalled();
    });

    it("сбойный провайдер — отказ с родовым сообщением, перебор остановлен", async () => {
        const registry = new LanguageFeatureRegistry<RenameProvider>();
        const second = vi.fn((): Promise<ICoreRenameResult> => Promise.resolve({ applied: true }));
        registry.register({ language: "typescript" }, provider({ provideRenameEdits: second }));
        registry.register(
            { language: "typescript" },
            provider({ provideRenameEdits: () => Promise.reject(new Error("rpc died")) }),
        );

        expect(await renameSymbol(registry, TS, REQUEST, "renamed")).toEqual({
            applied: false,
            error: "Rename failed",
        });
        expect(second).not.toHaveBeenCalled();
    });

    it("ни одного провайдера под документ — applied: false БЕЗ сообщения", async () => {
        const registry = new LanguageFeatureRegistry<RenameProvider>();
        const alien = vi.fn((): Promise<ICoreRenameResult> => Promise.resolve({ applied: true }));
        registry.register({ language: "python" }, provider({ provideRenameEdits: alien }));

        expect(await renameSymbol(registry, TS, REQUEST, "renamed")).toEqual({ applied: false });
        expect(alien).not.toHaveBeenCalled();
    });
});
