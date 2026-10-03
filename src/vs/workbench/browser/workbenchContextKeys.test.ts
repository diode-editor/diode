import type { TUIFocusEvent } from "@tuidom/core/dom/events/tuiFocusEvent";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { VFlexElement, vflexFixed } from "@tuidom/elements/layout/vFlexElement";
import { describe, expect, it, vi } from "vitest";

import type { IContextKeyContributor } from "../../platform/contextkey/common/contextKeyContributor.ts";
import { ContextKeyService } from "../../platform/contextkey/common/contextKeyService.ts";
import type { ServiceAccessor, Token } from "../../platform/instantiation/common/diContainer.ts";
import { token } from "../../platform/instantiation/common/diContainer.ts";
import type { EditorService } from "../services/editor/browser/editorService.ts";
import { FocusTracker } from "../services/focus/browser/focusTracker.ts";
import type { HistoryService } from "../services/history/browser/historyService.ts";
import type { KeybindingDispatcher } from "../services/keybinding/browser/keybindingDispatcher.ts";

import { WorkbenchContextKeys } from "./workbenchContextKeys.ts";

/**
 * Юнит-сценарии поверх фейков — краевые случаи, не достижимые из интеграционных
 * Workbench-тестов: update() до attachView (фокуса ещё нет), проводка хука
 * dispatcher.updateContextKeys и опрос контрибьюторов фич.
 */
function makeHarness(contributors: IContextKeyContributor[] = []) {
    const contextKeys = new ContextKeyService();
    // Контрибьюторы фич — по токену на каждого, accessor отдаёт их по токену.
    const contributorTokens = contributors.map((_, i) => token<IContextKeyContributor>(`Contributor${String(i)}`));
    const accessor = {
        get: (requested: Token<unknown>) =>
            contributors[contributorTokens.indexOf(requested as Token<IContextKeyContributor>)],
    } as unknown as ServiceAccessor;
    const focusTracker = new FocusTracker();
    const onDidChangeFocus = vi.fn();
    focusTracker.onDidChangeFocus(onDidChangeFocus);
    const cancelPendingChord = vi.fn();

    const dispatcher = {
        updateContextKeys: () => {},
        cancelPendingChord,
    };

    const service = new WorkbenchContextKeys(
        contextKeys,
        { editorCount: 0, groups: [], activeGroup: null, viewColumnOf: () => 1 } as unknown as EditorService,
        dispatcher as unknown as KeybindingDispatcher,
        { canGoBack: false, canGoForward: false } as unknown as HistoryService,
        focusTracker,
        accessor,
        contributorTokens,
    );

    return {
        service,
        contextKeys,
        onDidChangeFocus,
        cancelPendingChord,
        dispatcher,
    };
}

describe("WorkbenchContextKeys", () => {
    it("update() before attachView treats the active element as null", () => {
        const h = makeHarness();
        h.service.update();

        expect(h.contextKeys.get("textInputFocus")).toBe(false);
        expect(h.contextKeys.get("inputWidgetFocus")).toBe(false);
        expect(h.contextKeys.get("listFocus")).toBe(false);
        expect(h.contextKeys.get("terminalFocus")).toBe(false);
    });

    it("reflects service state into context keys", () => {
        const h = makeHarness();
        h.service.update();

        expect(h.contextKeys.get("editorGroupHasEditors")).toBe(false);
        expect(h.contextKeys.get("editorTabsMultiple")).toBe(false);
    });

    it("closes the dispatcher hook: updateContextKeys refreshes the keys", () => {
        const h = makeHarness();
        expect(h.contextKeys.get("editorGroupHasEditors")).toBeUndefined();
        h.dispatcher.updateContextKeys();
        expect(h.contextKeys.get("editorGroupHasEditors")).toBe(false);
    });

    it("опрашивает контрибьюторов фич по порядку списка — с сервисом ключей и активным элементом", () => {
        const calls: { name: string; keys: ContextKeyService; active: TUIElement | null }[] = [];
        const contributor = (name: string): IContextKeyContributor => ({
            updateContextKeys: (keys, active) => {
                calls.push({ name, keys, active });
            },
        });
        const h = makeHarness([contributor("first"), contributor("second")]);
        const focused = new FillerElement();
        h.service.attachView({ focusManager: { activeElement: focused } } as unknown as BodyElement);

        h.service.update();
        expect(calls).toEqual([
            { name: "first", keys: h.contextKeys, active: focused },
            { name: "second", keys: h.contextKeys, active: focused },
        ]);

        // Тайминг общий с центральными ключами: и хук диспетчера, и смена фокуса.
        h.dispatcher.updateContextKeys();
        h.service.handleFocusChange({} as TUIFocusEvent);
        expect(calls).toHaveLength(6);
    });

    it("handleFocusChange cancels a pending chord, refreshes keys and fires FocusTracker with the active element", () => {
        const h = makeHarness();
        const focused = new FillerElement();
        h.service.attachView({ focusManager: { activeElement: focused } } as unknown as BodyElement);
        h.onDidChangeFocus.mockImplementation(() => {
            // Подписчик видит уже освежённый контекст.
            expect(h.contextKeys.get("textInputFocus")).toBe(false);
        });
        h.service.handleFocusChange({} as TUIFocusEvent);

        expect(h.cancelPendingChord).toHaveBeenCalledTimes(1);
        expect(h.onDidChangeFocus).toHaveBeenCalledExactlyOnceWith(focused);
    });
});
