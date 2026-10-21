import { describe, it } from "vitest";

/**
 * Mocha-глобалы для дословно перенесённых upstream-тестов (импорт вставляет
 * `scripts/import-vscode-editor.mjs`). `timeout` — пустышка: в vitest срок задаётся
 * при регистрации; не влезает фаззинг — ищем причину, а не поднимаем срок.
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
