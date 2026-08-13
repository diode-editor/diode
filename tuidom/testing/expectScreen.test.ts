import { describe, expect, it } from "vitest";

import { MockTerminalBackend } from "../backend/mockTerminalBackend.ts";
import { Point, Size } from "../common/geometryPromitives.ts";

import { expectScreen, screen } from "./expectScreen.ts";

describe("screen tagged template", () => {
    it("strips leading/trailing blank lines and common indentation", () => {
        const result = screen`
            +--+
            |  |
            +--+
        `;
        expect(result).toBe("+--+\n|  |\n+--+");
    });

    it("interpolates values into the template", () => {
        const width = 4;
        const result = screen`
            [${width}]
        `;
        expect(result).toBe(`[${width}]`);
    });

    it("keeps content when there is no leading blank line (line 26 false branch)", () => {
        // Template starts immediately with content on the first line.
        const result = screen`abc
def`;
        expect(result).toBe("abc\ndef");
    });

    it("keeps content when there is no trailing blank line (line 29 false branch)", () => {
        const result = screen`
            abc
            def`;
        expect(result).toBe("abc\ndef");
    });

    it("returns an empty result when there are no non-empty lines (line 36 false branch)", () => {
        // Only blank lines: first and last are stripped, nothing non-empty remains.
        const result = screen`
        `;
        expect(result).toBe("");
    });

    it("preserves blank interior lines while dedenting non-empty ones", () => {
        const result = screen`
            top

            bottom
        `;
        expect(result).toBe("top\n\nbottom");
    });
});

describe("expectScreen", () => {
    it("passes when the backend screen matches the expected output", () => {
        const backend = new MockTerminalBackend(new Size(5, 3));
        backend.setCellAt(new Point(0, 0), "H");
        backend.setCellAt(new Point(1, 0), "i");

        expect(() => {
            expectScreen(
                backend,
                screen`
                    Hi
                `,
            );
        }).not.toThrow();
    });

    it("fails when the backend screen does not match", () => {
        const backend = new MockTerminalBackend(new Size(5, 3));
        backend.setCellAt(new Point(0, 0), "X");

        expect(() => {
            expectScreen(
                backend,
                screen`
                    Y
                `,
            );
        }).toThrow();
    });
});
