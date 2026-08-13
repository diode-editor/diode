import { describe, it } from "vitest";

import { expectScreen, screen } from "../../testing/expectScreen.ts";
import { renderElement } from "../../testing/renderElement.ts";
import type { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";

import { BoxElement } from "./boxElement.ts";

function renderBox(width: number, height: number): MockTerminalBackend {
    return renderElement(new BoxElement(), width, height);
}

describe("BoxElement", () => {
    it("renders a 6x3 box", () => {
        const backend = renderBox(6, 3);
        expectScreen(
            backend,
            screen`
                +----+
                |    |
                +----+
            `,
        );
    });

    it("renders a 4x4 box", () => {
        const backend = renderBox(4, 4);
        expectScreen(
            backend,
            screen`
                +--+
                |  |
                |  |
                +--+
            `,
        );
    });

    it("renders a minimal 2x2 box", () => {
        const backend = renderBox(2, 2);
        expectScreen(
            backend,
            screen`
                ++
                ++
            `,
        );
    });

    it("renders a 1x1 box as single +", () => {
        const backend = renderBox(1, 1);
        expectScreen(
            backend,
            screen`
                +
            `,
        );
    });

    it("renders a wide 10x2 box", () => {
        const backend = renderBox(10, 2);
        expectScreen(
            backend,
            screen`
                +--------+
                +--------+
            `,
        );
    });

    it("renders a tall 3x5 box", () => {
        const backend = renderBox(3, 5);
        expectScreen(
            backend,
            screen`
                +-+
                | |
                | |
                | |
                +-+
            `,
        );
    });

    it("renders a 3x1 horizontal line", () => {
        const backend = renderBox(3, 1);
        expectScreen(
            backend,
            screen`
                +-+
            `,
        );
    });

    it("renders a 1x3 vertical line", () => {
        const backend = renderBox(1, 3);
        expectScreen(
            backend,
            screen`
                +
                |
                +
            `,
        );
    });
});
