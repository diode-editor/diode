import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import { createRange } from "../../../editor/common/core/iRange.ts";
import type { IHoverRequest } from "../../../editor/common/languages/iHoverSource.ts";
import { LanguageFeaturesService } from "../../../editor/common/services/languageFeaturesService.ts";
import type { IExtensionLanguageFeaturesBridge } from "../common/iExtensionLanguageFeatures.ts";
import type { IWireLanguageProviderRegistration } from "../common/wireTypes.ts";

import { LanguageFeaturesAdapter } from "./languageFeaturesAdapter.ts";

const TS = { uri: Uri.file("/w/a.ts"), languageId: "typescript" };
const MD = { uri: Uri.file("/w/b.md"), languageId: "markdown" };
const REQUEST: IHoverRequest = { uri: TS.uri.toString(), languageId: "typescript", text: "x", line: 0, character: 0 };

/** Мост-заглушка: регистрации задаёт тест, событие — `fire()`. */
function makeBridge(): IExtensionLanguageFeaturesBridge & {
    providers: IWireLanguageProviderRegistration[];
    fire(): void;
    listeners: number;
} {
    const listeners: (() => void)[] = [];
    const bridge = {
        providers: [] as IWireLanguageProviderRegistration[],
        getLanguageProviders: () => bridge.providers,
        onLanguageProvidersChanged: (cb: () => void) => {
            listeners.push(cb);
            return {
                dispose: () => {
                    listeners.splice(listeners.indexOf(cb), 1);
                },
            };
        },
        provideHover: vi.fn((handle: number) => Promise.resolve({ contents: [`handle ${String(handle)}`] })),
        provideDefinition: vi.fn((handle: number) =>
            Promise.resolve([{ uri: `file:///def${String(handle)}.ts`, range: createRange(0, 0, 0, 1) }]),
        ),
        provideReferences: vi.fn((handle: number) =>
            Promise.resolve([{ uri: `file:///ref${String(handle)}.ts`, range: createRange(0, 0, 0, 1) }]),
        ),
        fire: () => {
            for (const cb of [...listeners]) cb();
        },
        get listeners() {
            return listeners.length;
        },
    };
    return bridge;
}

const hover = (handle: number, language = "typescript"): IWireLanguageProviderRegistration => ({
    handle,
    kind: "hover",
    selector: [{ language }],
});

describe("LanguageFeaturesAdapter", () => {
    it("подхватывает регистрации, объявленные до создания адаптера", async () => {
        const bridge = makeBridge();
        bridge.providers = [hover(1)];
        const features = new LanguageFeaturesService();

        new LanguageFeaturesAdapter(bridge, features);

        const [provider] = features.hoverProvider.ordered(TS);
        expect(await provider.provideHover(REQUEST)).toEqual({ contents: ["handle 1"] });
        expect(bridge.provideHover).toHaveBeenCalledWith(1, REQUEST);
    });

    it("definition и references — прокси в своих реестрах, зовут хост со своим handle", async () => {
        const bridge = makeBridge();
        bridge.providers = [
            { handle: 4, kind: "definition", selector: [{ language: "typescript" }] },
            { handle: 5, kind: "references", selector: [{ language: "typescript" }] },
        ];
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);
        expect(features.hoverProvider.has(TS)).toBe(false);

        const [definition] = features.definitionProvider.ordered(TS);
        expect(await definition.provideDefinition(REQUEST)).toEqual([
            { uri: "file:///def4.ts", range: createRange(0, 0, 0, 1) },
        ]);
        expect(bridge.provideDefinition).toHaveBeenCalledWith(4, REQUEST);

        const referenceRequest = { ...REQUEST, includeDeclaration: true };
        const [references] = features.referenceProvider.ordered(TS);
        expect(await references.provideReferences(referenceRequest)).toEqual([
            { uri: "file:///ref5.ts", range: createRange(0, 0, 0, 1) },
        ]);
        expect(bridge.provideReferences).toHaveBeenCalledWith(5, referenceRequest);
    });

    it("прокси регистрируется под селектором регистрации — чужой язык его не видит", () => {
        const bridge = makeBridge();
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);

        bridge.providers = [hover(1, "markdown")];
        bridge.fire();

        expect(features.hoverProvider.has(MD)).toBe(true);
        expect(features.hoverProvider.has(TS)).toBe(false);
    });

    it("снятая регистрация снимает прокси, оставшиеся живут", () => {
        const bridge = makeBridge();
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);
        const changed = vi.fn();

        bridge.providers = [hover(1), hover(2)];
        bridge.fire();
        features.hoverProvider.onDidChange(changed);
        bridge.providers = [bridge.providers[1]];
        bridge.fire();

        expect(features.hoverProvider.ordered(TS)).toHaveLength(1);
        // Живую регистрацию не перерегистрировали: событие одно — от снятия.
        expect(changed).toHaveBeenCalledTimes(1);
    });

    it("тот же handle с новой регистрацией (рестарт субпроцесса) — прокси пересоздаётся", () => {
        const bridge = makeBridge();
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);

        bridge.providers = [hover(0, "markdown")];
        bridge.fire();
        bridge.providers = [hover(0, "typescript")];
        bridge.fire();

        expect(features.hoverProvider.has(MD)).toBe(false);
        expect(features.hoverProvider.has(TS)).toBe(true);
    });

    it("dispose адаптера снимает все прокси и отписывается от моста", () => {
        const bridge = makeBridge();
        bridge.providers = [hover(1), hover(2)];
        const features = new LanguageFeaturesService();
        const adapter = new LanguageFeaturesAdapter(bridge, features);
        expect(bridge.listeners).toBe(1);

        adapter.dispose();

        expect(features.hoverProvider.has(TS)).toBe(false);
        expect(bridge.listeners).toBe(0);
    });
});
