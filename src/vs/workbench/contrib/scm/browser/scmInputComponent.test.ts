import { describe, expect, it, vi } from "vitest";

import type { IStateDescriptor, IStateService } from "../../../../platform/state/common/iStateService.ts";
import { SCM_INPUT_MESSAGE_STATE } from "../../../common/stateKeys.ts";

import { ScmCommitInputElement, ScmInputComponent } from "./scmInputComponent.ts";

function fakeState(): { service: IStateService; stored: Map<string, unknown> } {
    const stored = new Map<string, unknown>();
    const service: IStateService = {
        get<T>(descriptor: IStateDescriptor<T>): T {
            return stored.has(descriptor.key) ? (stored.get(descriptor.key) as T) : descriptor.default;
        },
        store<T>(descriptor: IStateDescriptor<T>, value: T): void {
            stored.set(descriptor.key, value);
        },
        openWorkspace: () => {},
        flushSync: () => {},
    };
    return { service, stored };
}

describe("ScmInputComponent", () => {
    it("поле с рамкой, плейсхолдером и id для e2e; обвязка — sideBar-фон", () => {
        const { service } = fakeState();
        const component = new ScmInputComponent(service);

        expect(component.input).toBeInstanceOf(ScmCommitInputElement);
        expect(component.input.id).toBe("scmCommitInput");
        expect(component.input.showBorder).toBe(true);
        expect(component.input.placeholder).toContain("Ctrl+Enter to commit");
        expect(component.view.id).toBe("scmInputBox");
        expect(component.view.style.bg).toBe("sideBar.background");
    });

    it("ввод пишет черновик write-through, setMessage заменяет значение и персистит", () => {
        const { service, stored } = fakeState();
        const component = new ScmInputComponent(service);

        component.input.inputState.insert("fix: typo");
        component.input.onChange?.(component.input.inputState.value);
        expect(component.message).toBe("fix: typo");
        expect(stored.get(SCM_INPUT_MESSAGE_STATE.key)).toBe("fix: typo");

        component.setMessage("");
        expect(component.message).toBe("");
        expect(stored.get(SCM_INPUT_MESSAGE_STATE.key)).toBe("");
    });

    it("focus() делегирует полю ввода", () => {
        const { service } = fakeState();
        const component = new ScmInputComponent(service);
        const focus = vi.spyOn(component.input, "focus").mockImplementation(() => {});
        component.focus();
        expect(focus).toHaveBeenCalledTimes(1);
    });

    it("restoreDraft читает workspace-стор без write-through; совпадение — no-op", () => {
        const { service, stored } = fakeState();
        stored.set(SCM_INPUT_MESSAGE_STATE.key, "draft message");
        const component = new ScmInputComponent(service);
        expect(component.message).toBe(""); // до restore — пусто

        const writes = vi.spyOn(service, "store");
        component.restoreDraft();
        expect(component.message).toBe("draft message");
        expect(writes).not.toHaveBeenCalled();

        component.restoreDraft(); // повтор — no-op
        expect(component.message).toBe("draft message");
    });
});
