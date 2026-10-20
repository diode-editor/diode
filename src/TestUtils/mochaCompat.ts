import { describe, it } from "vitest";

/**
 * Mocha-глобалы для дословно перенесённых upstream-тестов vscode
 * (`scripts/import-vscode-editor.mjs` вставляет импорт этого модуля после
 * баннера). У эталона `suite`/`test` глобальны (mocha, TDD-интерфейс), у нас —
 * vitest без глобалов.
 *
 * Mocha зовёт тело теста с контекстом `this`; перенесённые фаззинг-кейсы
 * зовут `this.timeout(ms)`. У vitest срок теста задаётся при регистрации, а не
 * изнутри, поэтому `timeout` здесь — пустышка: срок теста — дефолтный срок
 * vitest. Если фаззинг в него не влезает, причину ищем, а не поднимаем срок
 * (AGENTS.md).
 */
export interface IMochaContext {
    timeout(ms: number): void;
}

const context: IMochaContext = {
    timeout: () => undefined,
};

export function suite(name: string, body: () => void): void {
    describe(name, body);
}

export function test(name: string, body: (this: IMochaContext) => void | Promise<void>): void {
    it(name, () => body.call(context));
}
