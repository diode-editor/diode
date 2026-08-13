import { expect } from "vitest";

import type { MockTerminalBackend } from "../backend/mockTerminalBackend.ts";

/**
 * Tagged template literal that strips leading/trailing blank lines
 * and removes common indentation (dedent). Produces a clean multi-line
 * string for visual screen assertions.
 *
 * Usage:
 *   screen`
 *     +----+
 *     |    |
 *     +----+
 *   `
 */
export function screen(strings: TemplateStringsArray, ...values: unknown[]): string {
    // Reconstruct the full string from template parts
    let raw = strings[0];
    for (let i = 0; i < values.length; i++) {
        raw += String(values[i]) + strings[i + 1];
    }

    // Split into lines, remove first and last blank lines
    let lines = raw.split("\n");
    if (lines.length > 0 && lines[0].trim() === "") {
        lines.shift();
    }
    if (lines.length > 0 && lines[lines.length - 1].trim() === "") {
        lines.pop();
    }

    // Find minimum indentation (ignore empty lines)
    const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
    const minIndent =
        nonEmptyLines.length > 0
            ? /* v8 ignore next -- /^(\s*)/ always matches, so exec never returns null; the ?? 0 fallback is unreachable */
              Math.min(...nonEmptyLines.map((l) => /^(\s*)/.exec(l)?.[1].length ?? 0))
            : 0;

    // Strip common indent and trailing whitespace per line
    lines = lines.map((l) => l.slice(minIndent).trimEnd());

    return lines.join("\n");
}

/**
 * Normalize backend screen output: trim trailing spaces per line,
 * then trim trailing empty lines. Returns a compact string that
 * can be compared to `screen` tagged template output.
 */
function normalizeScreen(raw: string): string {
    const lines = raw.split("\n").map((l) => l.trimEnd());
    // Remove trailing empty lines
    while (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
    }
    return lines.join("\n");
}

/**
 * Assert that the backend's current screen matches the expected output.
 *
 * Usage:
 *   expectScreen(backend, screen`
 *     +----+
 *     |    |
 *     +----+
 *   `);
 */
export function expectScreen(backend: MockTerminalBackend, expected: string): void {
    const actual = normalizeScreen(backend.screenToString());
    expect(actual).toBe(expected);
}
