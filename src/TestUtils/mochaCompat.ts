import { describe, it } from "vitest";

/**
 * Mocha globals for vendored copies of upstream tests (the import is inserted by
 * `scripts/import-vscode-editor.mjs`). `timeout` is a no-op: vitest sets the timeout at
 * registration; if fuzzing doesn't fit, find the cause instead of raising the timeout.
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
