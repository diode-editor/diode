import { describe, expect, it } from "vitest";

import { statusToDecoration, xyToResourceStates } from "./map.ts";

describe("statusToDecoration", () => {
    it("maps a modified working-tree file (` M`) to the modified decoration", () => {
        expect(statusToDecoration(" M")).toEqual({
            badge: "M",
            colorId: "gitDecoration.modifiedResourceForeground",
        });
    });

    it("maps a staged add (`A `) to the added decoration", () => {
        expect(statusToDecoration("A ")).toEqual({
            badge: "A",
            colorId: "gitDecoration.addedResourceForeground",
        });
    });

    it("maps a deletion (`D `) to the deleted decoration", () => {
        expect(statusToDecoration("D ")).toEqual({
            badge: "D",
            colorId: "gitDecoration.deletedResourceForeground",
        });
    });

    it("maps a rename (`R `) to the renamed decoration", () => {
        expect(statusToDecoration("R ")).toEqual({
            badge: "R",
            colorId: "gitDecoration.renamedResourceForeground",
        });
    });

    it("maps a copy (`C `) to the renamed decoration", () => {
        expect(statusToDecoration("C ")).toEqual({
            badge: "C",
            colorId: "gitDecoration.renamedResourceForeground",
        });
    });

    it("maps untracked (`??`) to the untracked decoration with a `U` badge", () => {
        expect(statusToDecoration("??")).toEqual({
            badge: "U",
            colorId: "gitDecoration.untrackedResourceForeground",
        });
    });

    it("maps ignored (`!!`) to the ignored decoration with an `I` badge", () => {
        expect(statusToDecoration("!!")).toEqual({
            badge: "I",
            colorId: "gitDecoration.ignoredResourceForeground",
        });
    });

    it("maps an unmerged combination (`UU`) to the conflicting decoration", () => {
        expect(statusToDecoration("UU")).toEqual({
            badge: "U",
            colorId: "gitDecoration.conflictingResourceForeground",
        });
    });

    it("maps a both-deleted conflict (`DD`) to the conflicting decoration", () => {
        expect(statusToDecoration("DD")).toEqual({
            badge: "U",
            colorId: "gitDecoration.conflictingResourceForeground",
        });
    });

    it("prefers the index status over the working tree (`MD` → modified)", () => {
        expect(statusToDecoration("MD").badge).toBe("M");
    });

    it("falls back to the working-tree status when the index is clean (` A` → added)", () => {
        expect(statusToDecoration(" A").badge).toBe("A");
    });

    it("falls back to the modified decoration for an unknown code (`TT`)", () => {
        expect(statusToDecoration("TT")).toEqual({
            badge: "M",
            colorId: "gitDecoration.modifiedResourceForeground",
        });
    });
});

describe("xyToResourceStates", () => {
    const MODIFIED = "gitDecoration.modifiedResourceForeground";
    const ADDED = "gitDecoration.addedResourceForeground";

    it("` M` → одна запись worktree", () => {
        expect(xyToResourceStates(" M")).toEqual([{ group: "worktree", badge: "M", colorId: MODIFIED }]);
    });

    it("`M ` → одна запись index", () => {
        expect(xyToResourceStates("M ")).toEqual([{ group: "index", badge: "M", colorId: MODIFIED }]);
    });

    it("`MM` → две записи: index и worktree, каждая со своей буквой", () => {
        expect(xyToResourceStates("MM")).toEqual([
            { group: "index", badge: "M", colorId: MODIFIED },
            { group: "worktree", badge: "M", colorId: MODIFIED },
        ]);
    });

    it("`AM` → добавленный в индексе + изменённый в дереве", () => {
        expect(xyToResourceStates("AM")).toEqual([
            { group: "index", badge: "A", colorId: ADDED },
            { group: "worktree", badge: "M", colorId: MODIFIED },
        ]);
    });

    it("`??` → untracked с цветом untracked", () => {
        expect(xyToResourceStates("??")).toEqual([
            { group: "untracked", badge: "U", colorId: "gitDecoration.untrackedResourceForeground" },
        ]);
    });

    it("unmerged-коды → одна merge-запись с conflicting-цветом", () => {
        for (const xy of ["DD", "AU", "UD", "UA", "DU", "AA", "UU"]) {
            expect(xyToResourceStates(xy)).toEqual([
                { group: "merge", badge: "U", colorId: "gitDecoration.conflictingResourceForeground" },
            ]);
        }
    });

    it("`!!` (ignored) не публикуется вовсе", () => {
        expect(xyToResourceStates("!!")).toEqual([]);
    });

    it("неизвестная буква сохраняет саму букву с modified-цветом (`T `)", () => {
        expect(xyToResourceStates("T ")).toEqual([{ group: "index", badge: "T", colorId: MODIFIED }]);
    });
});
