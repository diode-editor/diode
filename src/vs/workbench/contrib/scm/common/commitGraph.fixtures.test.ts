import { describe, expect, it } from "vitest";

import type { IGraphCommit } from "./commitGraph.ts";
import { renderCommitGraph } from "./commitGraph.ts";

/**
 * Приёмочные фикстуры порта — кейсы `TestRenderCommitGraph` из lazygit
 * (`pkg/gui/presentation/graph/graph_test.go`), перенесённые дословно. Это
 * главный гейт корректности укладки: любая перестановка шагов в `getNextPipes`
 * ломает хотя бы один из них.
 *
 * Сверка как в оригинале: строка = `hash` + пробел + графика, с обрезкой
 * хвостовых пробелов (клетка всегда занимает два знака, последний — пустой
 * соединитель).
 */
function render(commits: readonly IGraphCommit[]): string {
    // Выделенного коммита нет: "blah" не совпадает ни с одним хешем — ровно как
    // в lazygit, где подсветка в этих кейсах выключена.
    const lines = renderCommitGraph(commits, "blah", () => "graphStyle");
    return lines.map((line, index) => `${commits[index].sha} ${line.text}`.trimEnd()).join("\n");
}

/** `{Hash: "1", Parents: []string{"2"}}` → компактная запись `"1 2"`. */
function commits(...rows: readonly string[]): IGraphCommit[] {
    return rows.map((row) => {
        const [sha, ...parents] = row.split(" ");
        return { sha, parents };
    });
}

/** Ожидаемый блок из теста Go: снимаем отступы, которыми он выровнен в исходнике. */
function expected(block: string): string {
    return block
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .join("\n");
}

describe("renderCommitGraph — фикстуры lazygit", () => {
    it("with some merges", () => {
        expect(
            render(
                commits(
                    "1 2",
                    "2 3",
                    "3 4",
                    "4 5 7",
                    "7 5",
                    "5 8",
                    "8 9",
                    "9 A B",
                    "B D",
                    "D D",
                    "A E",
                    "E F",
                    "F D",
                    "D G",
                ),
            ),
        ).toBe(
            expected(`
                1 ○
                2 ○
                3 ○
                4 ◎─╮
                7 │ ○
                5 ○─╯
                8 ○
                9 ◎─╮
                B │ ○
                D │ ○
                A ○ │
                E ○ │
                F ○ │
                D ○─╯`),
        );
    });

    it("with a path that has room to move to the left", () => {
        expect(render(commits("1 2", "2 3 4", "4 3 5", "3 5", "5 6", "6 7"))).toBe(
            expected(`
                1 ○
                2 ◎─╮
                4 │ ◎─╮
                3 ○─╯ │
                5 ○───╯
                6 ○`),
        );
    });

    it("with a new commit (несвязанный корень, git log --all)", () => {
        expect(render(commits("1 2", "2 3 4", "4 3 5", "Z Z", "3 5", "5 6", "6 7"))).toBe(
            expected(`
                1 ○
                2 ◎─╮
                4 │ ◎─╮
                Z │ │ │ ○
                3 ○─╯ │ │
                5 ○───╯ │
                6 ○ ╭───╯`),
        );
    });

    it("with a path that has room to move to the left and continues", () => {
        expect(render(commits("1 2", "2 3 4", "3 5 4", "5 7 8", "4 7", "7 11"))).toBe(
            expected(`
                1 ○
                2 ◎─╮
                3 ◎─│─╮
                5 ◎─│─│─╮
                4 │ ○─╯ │
                7 ○─╯ ╭─╯`),
        );
    });

    it("with a path that has room to move to the left and continues (2)", () => {
        expect(render(commits("1 2", "2 3 4", "3 5 4", "5 7 8", "7 4 A", "4 B", "B C"))).toBe(
            expected(`
                1 ○
                2 ◎─╮
                3 ◎─│─╮
                5 ◎─│─│─╮
                7 ◎─│─│─│─╮
                4 ○─┴─╯ │ │
                B ○ ╭───╯ │`),
        );
    });

    it("with a path that has room to move to the left and continues (3)", () => {
        expect(render(commits("1 2 3", "3 2", "2 4 5", "4 6 7", "6 8"))).toBe(
            expected(`
                1 ◎─╮
                3 │ ○
                2 ◎─│
                4 ◎─│─╮
                6 ○ │ │`),
        );
    });

    it("new merge path fills gap before continuing path on right (октопус)", () => {
        expect(render(commits("1 2 3 4 5", "4 2", "2 A", "A 6 B", "B C"))).toBe(
            expected(`
                1 ◎─┬─┬─╮
                4 │ │ ○ │
                2 ○─│─╯ │
                A ◎─│─╮ │
                B │ │ ○ │`),
        );
    });

    it("with a path that has room to move to the left and continues (4)", () => {
        expect(render(commits("1 2", "2 3 4", "3 5 4", "5 7 8", "7 4 A", "4 B", "B C", "C D"))).toBe(
            expected(`
                1 ○
                2 ◎─╮
                3 ◎─│─╮
                5 ◎─│─│─╮
                7 ◎─│─│─│─╮
                4 ○─┴─╯ │ │
                B ○ ╭───╯ │
                C ○ │ ╭───╯`),
        );
    });

    it("with a path that has room to move to the left and continues (5)", () => {
        expect(
            render(commits("1 2", "2 3 4", "3 5 4", "5 7 G", "7 8 A", "8 4 E", "4 B", "B C", "C D", "D F")),
        ).toBe(
            expected(`
                1 ○
                2 ◎─╮
                3 ◎─│─╮
                5 ◎─│─│─╮
                7 ◎─│─│─│─╮
                8 ◎─│─│─│─│─╮
                4 ○─┴─╯ │ │ │
                B ○ ╭───╯ │ │
                C ○ │ ╭───╯ │
                D ○ │ │ ╭───╯`),
        );
    });

    it("пустой список коммитов — пустой граф", () => {
        expect(renderCommitGraph([], null, () => "graphStyle")).toEqual([]);
    });
});
