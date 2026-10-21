import { describe, expect, it } from "vitest";

import { createInsertEdit } from "../core/iTextEdit.ts";

import { TextDocument } from "./textDocument.ts";

function generateLargeText(lineCount: number): string {
    const lines: string[] = [];
    for (let i = 0; i < lineCount; i++) {
        lines.push(`Line ${String(i).padStart(6, "0")}: content goes here for testing`);
    }
    return lines.join("\n");
}

/** LCG; integers in [0, max). */
function makePrng(seed: number) {
    let state = seed;
    return (max: number): number => {
        state = (state * 1664525 + 1013904223) & 0xffffffff;
        return Math.abs(state) % max;
    };
}

const LINE_COUNT = 1_000_000;
const EDIT_COUNT = 1_000;

describe("TextDocument array-backend performance (baseline)", () => {
    it("load: new TextDocument(1M lines) + getText() round-trip", () => {
        const text = generateLargeText(LINE_COUNT);

        const t0 = performance.now();
        const doc = new TextDocument(text);
        const loadMs = performance.now() - t0;

        const t1 = performance.now();
        const result = doc.getText();
        const getTextMs = performance.now() - t1;

        console.log(`[array] load:    ${loadMs.toFixed(1)} ms`);
        console.log(`[array] getText: ${getTextMs.toFixed(1)} ms`);

        expect(doc.lineCount).toBe(LINE_COUNT);
        expect(result.length).toBeGreaterThan(0);
    }, 60_000);

    it("insertAtStart: 1000 inserts at (0,0) in 1M-line doc — array is slow (O(n·k))", () => {
        const doc = new TextDocument(generateLargeText(LINE_COUNT));

        const t0 = performance.now();
        for (let i = 0; i < EDIT_COUNT; i++) {
            doc.applyEdits([createInsertEdit(0, 0, "x\n")]);
        }
        const ms = performance.now() - t0;

        console.log(`[array] insertAtStart ×${EDIT_COUNT}: ${ms.toFixed(1)} ms`);

        expect(doc.lineCount).toBe(LINE_COUNT + EDIT_COUNT);
    }, 60_000);

    it("randomInserts: 1000 random inserts in 1M-line doc — array is slow (O(n·k))", () => {
        const doc = new TextDocument(generateLargeText(LINE_COUNT));
        const rand = makePrng(0xdeadbeef);

        const t0 = performance.now();
        for (let i = 0; i < EDIT_COUNT; i++) {
            const line = rand(doc.lineCount);
            doc.applyEdits([createInsertEdit(line, 0, "x\n")]);
        }
        const ms = performance.now() - t0;

        console.log(`[array] randomInserts ×${EDIT_COUNT}: ${ms.toFixed(1)} ms`);

        expect(doc.lineCount).toBe(LINE_COUNT + EDIT_COUNT);
    }, 60_000);
});
