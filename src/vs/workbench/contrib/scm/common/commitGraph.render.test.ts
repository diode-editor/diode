import { describe, expect, it } from "vitest";

import type { IPipe } from "./commitGraph.ts";
import { GRAPH_HIGHLIGHT_STYLE, PipeKind, renderPipeSet } from "./commitGraph.ts";

/**
 * Кейсы `TestRenderPipeSet` из lazygit — они проверяют не только символы, но и
 * **цвет каждого символа**: приоритет «вертикаль важнее горизонтали», перекрытие
 * соединителя стартующей линией и подсветку линий выделенного коммита.
 *
 * Цвета в оригинале — ANSI-стили; здесь это произвольные строки-имена, ядру
 * графа они непрозрачны. `undefined` — оригинальный `style.Nothing`: пробел не
 * красится.
 */
const CYAN = "cyan";
const RED = "red";
const GREEN = "green";
const YELLOW = "yellow";
const MAGENTA = "magenta";
const H = GRAPH_HIGHLIGHT_STYLE;

const SELECTED = "selected";

function pipe(
    fromPos: number,
    toPos: number,
    fromHash: string,
    toHash: string,
    kind: PipeKind,
    style: string,
): IPipe {
    return { fromPos, toPos, fromHash, toHash, kind, style };
}

/**
 * Сверка как в Go: ожидаемая строка без хвостового пробела последней клетки —
 * его дописываем сами, вместе с его «нецветом».
 */
function check(
    pipes: readonly IPipe[],
    prevCommitHash: string | null,
    expectedText: string,
    expectedStyles: readonly (string | undefined)[],
): void {
    expect([...expectedText]).toHaveLength(expectedStyles.length);
    const line = renderPipeSet(pipes, SELECTED, prevCommitHash);
    expect(line.text).toBe(`${expectedText} `);
    expect(line.styles).toEqual([...expectedStyles, undefined]);
}

describe("renderPipeSet — символы и цвета", () => {
    it("single cell", () => {
        check(
            [
                pipe(0, 0, "a", "b", PipeKind.Terminates, CYAN),
                pipe(0, 0, "b", "c", PipeKind.Starts, GREEN),
            ],
            "a",
            "○",
            [GREEN],
        );
    });

    it("single cell, selected", () => {
        check(
            [
                pipe(0, 0, "a", SELECTED, PipeKind.Terminates, CYAN),
                pipe(0, 0, SELECTED, "c", PipeKind.Starts, GREEN),
            ],
            "a",
            "○",
            [H],
        );
    });

    it("terminating hook and starting hook, selected", () => {
        check(
            [
                pipe(0, 0, "a", SELECTED, PipeKind.Terminates, CYAN),
                pipe(1, 0, "c", SELECTED, PipeKind.Terminates, YELLOW),
                pipe(0, 0, SELECTED, "d", PipeKind.Starts, GREEN),
                pipe(0, 1, SELECTED, "e", PipeKind.Starts, GREEN),
            ],
            "a",
            "◎─╮",
            [H, H, H],
        );
    });

    it("terminating hook and starting hook, prioritise the terminating one", () => {
        check(
            [
                pipe(0, 0, "a", "b", PipeKind.Terminates, RED),
                pipe(1, 0, "c", "b", PipeKind.Terminates, MAGENTA),
                pipe(0, 0, "b", "d", PipeKind.Starts, GREEN),
                pipe(0, 1, "b", "e", PipeKind.Starts, GREEN),
            ],
            "a",
            "◎─│",
            [GREEN, GREEN, MAGENTA],
        );
    });

    it("starting and terminating pipe sharing some space", () => {
        check(
            [
                pipe(0, 0, "a1", "a2", PipeKind.Terminates, RED),
                pipe(0, 0, "a2", "a3", PipeKind.Starts, YELLOW),
                pipe(1, 1, "b1", "b2", PipeKind.Continues, MAGENTA),
                pipe(3, 0, "e1", "a2", PipeKind.Terminates, GREEN),
                pipe(0, 2, "a2", "c3", PipeKind.Starts, YELLOW),
            ],
            "a1",
            "◎─│─┬─╯",
            [YELLOW, YELLOW, MAGENTA, YELLOW, YELLOW, GREEN, GREEN],
        );
    });

    it("starting and terminating pipe sharing some space, with selection", () => {
        check(
            [
                pipe(0, 0, "a1", SELECTED, PipeKind.Terminates, RED),
                pipe(0, 0, SELECTED, "a3", PipeKind.Starts, YELLOW),
                pipe(1, 1, "b1", "b2", PipeKind.Continues, MAGENTA),
                pipe(3, 0, "e1", SELECTED, PipeKind.Terminates, GREEN),
                pipe(0, 2, SELECTED, "c3", PipeKind.Starts, YELLOW),
            ],
            "a1",
            "◎───╮ ╯",
            [H, H, H, H, H, undefined, GREEN],
        );
    });

    it("many terminating pipes", () => {
        check(
            [
                pipe(0, 0, "a1", "a2", PipeKind.Terminates, RED),
                pipe(0, 0, "a2", "a3", PipeKind.Starts, YELLOW),
                pipe(1, 0, "b1", "a2", PipeKind.Terminates, MAGENTA),
                pipe(2, 0, "c1", "a2", PipeKind.Terminates, GREEN),
            ],
            "a1",
            "○─┴─╯",
            [YELLOW, MAGENTA, MAGENTA, GREEN, GREEN],
        );
    });

    it("starting pipe passing through", () => {
        check(
            [
                pipe(0, 0, "a1", "a2", PipeKind.Terminates, RED),
                pipe(0, 0, "a2", "a3", PipeKind.Starts, YELLOW),
                pipe(0, 3, "a2", "d3", PipeKind.Starts, YELLOW),
                pipe(1, 1, "b1", "b3", PipeKind.Continues, MAGENTA),
                pipe(2, 2, "c1", "c3", PipeKind.Continues, GREEN),
            ],
            "a1",
            "◎─│─│─╮",
            [YELLOW, YELLOW, MAGENTA, YELLOW, GREEN, YELLOW, YELLOW],
        );
    });

    it("starting and terminating path crossing continuing path", () => {
        check(
            [
                pipe(0, 0, "a1", "a2", PipeKind.Terminates, RED),
                pipe(0, 0, "a2", "a3", PipeKind.Starts, YELLOW),
                pipe(0, 1, "a2", "b3", PipeKind.Starts, YELLOW),
                pipe(1, 1, "b1", "a2", PipeKind.Continues, GREEN),
                pipe(2, 0, "c1", "a2", PipeKind.Terminates, MAGENTA),
            ],
            "a1",
            "◎─│─╯",
            [YELLOW, YELLOW, GREEN, MAGENTA, MAGENTA],
        );
    });

    it("another clash of starting and terminating paths", () => {
        check(
            [
                pipe(0, 0, "a1", "a2", PipeKind.Terminates, RED),
                pipe(0, 0, "a2", "a3", PipeKind.Starts, YELLOW),
                pipe(0, 1, "a2", "b3", PipeKind.Starts, YELLOW),
                pipe(2, 2, "c1", "c3", PipeKind.Continues, GREEN),
                pipe(3, 0, "d1", "a2", PipeKind.Terminates, MAGENTA),
            ],
            "a1",
            "◎─┬─│─╯",
            [YELLOW, YELLOW, YELLOW, MAGENTA, GREEN, MAGENTA, MAGENTA],
        );
    });

    it("commit whose previous commit is selected", () => {
        check(
            [
                pipe(0, 0, SELECTED, "a2", PipeKind.Terminates, RED),
                pipe(0, 0, "a2", "a3", PipeKind.Starts, YELLOW),
            ],
            SELECTED,
            "○",
            [YELLOW],
        );
    });

    it("commit whose previous commit is selected and is a merge commit", () => {
        check(
            [
                pipe(0, 0, SELECTED, "a2", PipeKind.Terminates, RED),
                pipe(1, 1, SELECTED, "b3", PipeKind.Continues, RED),
            ],
            SELECTED,
            "○ │",
            [H, undefined, H],
        );
    });

    it("commit whose previous commit is selected and is a merge commit, with continuing pipe inbetween", () => {
        check(
            [
                pipe(0, 0, SELECTED, "a2", PipeKind.Terminates, RED),
                pipe(1, 1, "z1", "z3", PipeKind.Continues, GREEN),
                pipe(2, 2, SELECTED, "b3", PipeKind.Continues, RED),
            ],
            SELECTED,
            "○ │ │",
            [H, undefined, GREEN, undefined, H],
        );
    });

    it("when previous commit is selected, not a merge commit, and spawns a continuing pipe", () => {
        check(
            [
                pipe(0, 0, "a1", "a2", PipeKind.Terminates, RED),
                pipe(0, 0, "a2", "a3", PipeKind.Starts, GREEN),
                pipe(0, 1, "a2", "b3", PipeKind.Starts, GREEN),
                pipe(1, 0, SELECTED, "a2", PipeKind.Terminates, YELLOW),
            ],
            SELECTED,
            "◎─╯",
            [H, H, H],
        );
    });

    it("без выделенного коммита подсветки нет", () => {
        const line = renderPipeSet(
            [
                pipe(0, 0, "a", "b", PipeKind.Terminates, CYAN),
                pipe(0, 0, "b", "c", PipeKind.Starts, GREEN),
            ],
            null,
            null,
        );
        expect(line.text).toBe("○ ");
        expect(line.styles).toEqual([GREEN, undefined]);
    });
});
