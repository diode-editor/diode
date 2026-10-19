import { expect, vi } from "vitest";

import type { QuickInputComponent } from "../vs/workbench/browser/parts/quickinput/quickInputComponent.ts";
import { QuickInputComponentDIToken } from "../vs/workbench/browser/parts/quickinput/quickInputComponent.ts";

import type { IAppHarness } from "./AppTestHarness.ts";

/**
 * Водитель диалога файлов (`SimpleFileDialog` на общем QuickInput-оверлее) в
 * приложении из харнесса: ждать состояния и печатать так, как это делает
 * человек, — клавишами, через настоящий ввод.
 */
export interface IFileDialogDriver {
    readonly component: QuickInputComponent;
    /** Снимок виджета: запрос, заголовок, строки, подсветка. */
    state(): Record<string, unknown>;
    /** Дождаться, пока снимок совпадёт с ожиданием (подгрузка каталога асинхронна). */
    settle(expected: Record<string, unknown>): Promise<void>;
    /** Заменить строку запроса набранным текстом (выделить всё и напечатать). */
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
