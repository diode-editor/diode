import { describe, expect, it } from "vitest";

import type { IPipe } from "./commitGraph.ts";
import {
    EMPTY_TREE_HASH,
    getNextPipes,
    getPipeSets,
    GRAPH_DEFAULT_STYLE,
    PipeKind,
    START_HASH,
} from "./commitGraph.ts";

/**
 * Кейсы `TestGetNextPipes` из lazygit: укладка пайпов строки — до всякой
 * отрисовки. Здесь ловятся ошибки порядка шагов (кто занимает колонку раньше) и
 * подстановка пустого дерева вместо родителя у корневого коммита.
 */
const STYLE = "graphStyle";
const getStyle = (): string => STYLE;

function pipe(fromPos: number, toPos: number, fromHash: string, toHash: string, kind: PipeKind): IPipe {
    return { fromPos, toPos, fromHash, toHash, kind, style: STYLE };
}

describe("getNextPipes", () => {
    it("линия доходит до своего родителя и стартует новая", () => {
        expect(
            getNextPipes([pipe(0, 0, "a", "b", PipeKind.Starts)], { sha: "b", parents: ["c"] }, getStyle),
        ).toEqual([
            pipe(0, 0, "a", "b", PipeKind.Terminates),
            pipe(0, 0, "b", "c", PipeKind.Starts),
        ]);
    });

    it("терминировавший пайп предыдущей строки в расчёт не идёт, соседний продолжается", () => {
        expect(
            getNextPipes(
                [
                    pipe(0, 0, "a", "b", PipeKind.Terminates),
                    pipe(0, 0, "b", "c", PipeKind.Starts),
                    pipe(0, 1, "b", "d", PipeKind.Starts),
                ],
                { sha: "d", parents: ["e"] },
                getStyle,
            ),
        ).toEqual([
            pipe(0, 0, "b", "c", PipeKind.Continues),
            pipe(1, 1, "b", "d", PipeKind.Terminates),
            pipe(1, 1, "d", "e", PipeKind.Starts),
        ]);
    });

    it("корневой коммит уходит в пустое дерево", () => {
        expect(
            getNextPipes([pipe(0, 0, "a", "root", PipeKind.Terminates)], { sha: "root", parents: [] }, getStyle),
        ).toEqual([pipe(1, 1, "root", EMPTY_TREE_HASH, PipeKind.Starts)]);
    });

    it("merge-коммит раздаёт дополнительным родителям свободные колонки справа", () => {
        expect(
            getNextPipes([pipe(0, 0, "a", "b", PipeKind.Starts)], { sha: "b", parents: ["c", "d", "e"] }, getStyle),
        ).toEqual([
            pipe(0, 0, "a", "b", PipeKind.Terminates),
            pipe(0, 0, "b", "c", PipeKind.Starts),
            pipe(0, 1, "b", "d", PipeKind.Starts),
            pipe(0, 2, "b", "e", PipeKind.Starts),
        ]);
    });
});

describe("getPipeSets", () => {
    it("затравочный пайп ставит первый коммит в нулевую колонку", () => {
        const sets = getPipeSets([{ sha: "1", parents: ["2"] }], getStyle);
        expect(sets).toHaveLength(1);
        expect(sets[0]).toEqual([
            // Терминатор затравки наследует её цвет; в кадре он не виден —
            // вырожденный TERMINATES в колонке коммита рендер пропускает.
            { ...pipe(0, 0, START_HASH, "1", PipeKind.Terminates), style: GRAPH_DEFAULT_STYLE },
            pipe(0, 0, "1", "2", PipeKind.Starts),
        ]);
    });

    it("на каждый коммит приходится ровно один набор пайпов", () => {
        const sets = getPipeSets([{ sha: "1", parents: ["2"] }, { sha: "2", parents: [] }], getStyle);
        expect(sets).toHaveLength(2);
    });

    it("пустой список коммитов — пустой результат", () => {
        expect(getPipeSets([], getStyle)).toEqual([]);
    });
});
