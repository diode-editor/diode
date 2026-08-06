import { describe, expect, it, vi } from "vitest";

import type { TUIFocusEvent } from "../../../../tuidom/dom/events/tuiFocusEvent.ts";
import { BodyElement } from "../../../../tuidom/ui/body/bodyElement.ts";
import { ContextKeyService } from "../../platform/contextkey/common/contextKeyService.ts";
import type { InputWidgetService } from "../contrib/files/browser/inputWidgetService.ts";
import type { FindService } from "../contrib/find/browser/findService.ts";
import type { CompletionService } from "../contrib/suggest/browser/completionService.ts";
import type { TerminalService } from "../contrib/terminal/browser/terminalService.ts";
import type { EditorService } from "../services/editor/browser/editorService.ts";
import type { KeybindingDispatcher } from "../services/keybinding/browser/keybindingDispatcher.ts";
import type { LayoutService } from "../services/layout/browser/layoutService.ts";
import type { TerminalEnvironmentService } from "../services/terminalEnvironment/node/terminalEnvironmentService.ts";

import type { SearchComponent } from "../contrib/search/browser/searchComponent.ts";

import type { SidebarService } from "./parts/sidebar/sidebarService.ts";
import { WorkbenchContextKeys } from "./workbenchContextKeys.ts";

/**
 * Юнит-сценарии поверх фейков — краевые случаи, не достижимые из интеграционных
 * Workbench-тестов: update() до attachView (фокуса ещё нет) и проводка
 * хуков (dispatcher.updateContextKeys, onDidChange терминального окружения).
 */
function makeHarness() {
    const contextKeys = new ContextKeyService();
    const setActive = vi.fn();
    const onFocusChanged = vi.fn();
    const cancelPendingChord = vi.fn();
    let envListener: (() => void) | null = null;

    const dispatcher = {
        updateContextKeys: () => {},
        cancelPendingChord,
    };
    const terminalEnv = {
        tier: "legacy",
        os: "linux",
        getKnownModeNames: () => ["local", "custom"],
        isModeActive: (name: string) => name === "local",
        hasCapability: () => false,
        onDidChange: (listener: () => void) => {
            envListener = listener;
            return { dispose: () => (envListener = null) };
        },
    };

    const service = new WorkbenchContextKeys(
        contextKeys,
        { editorCount: 0 } as unknown as EditorService,
        { isVisible: () => false } as unknown as FindService,
        { isOpen: () => false, onFocusChanged } as unknown as CompletionService,
        { hasOpenTerminals: false } as unknown as TerminalService,
        terminalEnv as unknown as TerminalEnvironmentService,
        { setActive } as unknown as InputWidgetService,
        dispatcher as unknown as KeybindingDispatcher,
        { isPanelVisible: () => true, isSidebarVisible: () => true } as unknown as LayoutService,
        { getActiveViewletId: () => "search" } as unknown as SidebarService,
        {
            containsFocus: () => false,
            isInputBoxFocused: () => false,
            isFirstResultFocused: () => false,
        } as unknown as SearchComponent,
    );

    return {
        service,
        contextKeys,
        setActive,
        onFocusChanged,
        cancelPendingChord,
        dispatcher,
        fireEnvChange: () => envListener?.(),
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
        expect(h.setActive).toHaveBeenCalledWith(null);
    });

    it("reflects service state into context keys", () => {
        const h = makeHarness();
        h.service.update();

        expect(h.contextKeys.get("editorGroupHasEditors")).toBe(false);
        expect(h.contextKeys.get("editorTabsMultiple")).toBe(false);
        expect(h.contextKeys.get("panelVisible")).toBe(true); // из LayoutService
        expect(h.contextKeys.get("findWidgetVisible")).toBe(false);
        expect(h.contextKeys.get("suggestWidgetVisible")).toBe(false);
        expect(h.contextKeys.get("terminalIsOpen")).toBe(false);
        expect(h.contextKeys.get("tier")).toBe("legacy");
        expect(h.contextKeys.get("os")).toBe("linux");
        expect(h.contextKeys.get("isLinux")).toBe(true);
        expect(h.contextKeys.get("isMac")).toBe(false);
        // Динамические mode_-ключи из терминального окружения.
        expect(h.contextKeys.evaluate("mode_local")).toBe(true);
        expect(h.contextKeys.evaluate("mode_custom")).toBe(false);
    });

    it("closes the dispatcher hook: updateContextKeys refreshes the keys", () => {
        const h = makeHarness();
        expect(h.contextKeys.get("editorGroupHasEditors")).toBeUndefined();
        h.dispatcher.updateContextKeys();
        expect(h.contextKeys.get("editorGroupHasEditors")).toBe(false);
    });

    it("re-pushes keys when the terminal environment changes", () => {
        const h = makeHarness();
        h.fireEnvChange();
        expect(h.contextKeys.get("tier")).toBe("legacy");

        // Подписка снимается при dispose.
        h.service.dispose();
        h.contextKeys.reset("tier");
        h.fireEnvChange();
        expect(h.contextKeys.get("tier")).toBeUndefined();
    });

    it("handleFocusChange cancels a pending chord, refreshes keys and notifies completion", () => {
        const h = makeHarness();
        h.service.attachView(new BodyElement());
        h.service.handleFocusChange({} as TUIFocusEvent);

        expect(h.cancelPendingChord).toHaveBeenCalledTimes(1);
        expect(h.contextKeys.get("textInputFocus")).toBe(false);
        // Активный элемент — не редактор (фокус-менеджера нет) → попап закрывается.
        expect(h.onFocusChanged).toHaveBeenCalledWith(false);
    });
});
