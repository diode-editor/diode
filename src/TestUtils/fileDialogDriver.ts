import { expect, vi } from "vitest";

import type { QuickInputComponent } from "../vs/workbench/browser/parts/quickinput/quickInputComponent.ts";
import { QuickInputComponentDIToken } from "../vs/workbench/browser/parts/quickinput/quickInputComponent.ts";

import type { IAppHarness } from "./AppTestHarness.ts";

/** Types through real key input — like a human. */
export interface IFileDialogDriver {
    readonly component: QuickInputComponent;
    state(): Record<string, unknown>;
    /** Directory loading is asynchronous. */
    settle(expected: Record<string, unknown>): Promise<void>;
    replaceQuery(text: string): void;
    key(name: string): void;
    validationMessage(): string | null;
}

export function fileDialogDriver(h: IAppHarness): IFileDialogDriver {
    const component = h.container.get(QuickInputComponentDIToken);
    const state = (): Record<string, unknown> => component.view.inspectState();
    return {
        component,
        state,
        settle: async (expected) => {
            await vi.waitFor(() => {
                expect(state()).toMatchObject(expected);
            });
        },
        replaceQuery: (text) => {
            component.view.inputElement.inputState.selectAll();
            for (const ch of text) h.testApp.sendKey(ch);
        },
        key: (name) => {
            h.testApp.sendKey(name);
        },
        validationMessage: () => component.view.validationMessage,
    };
}
