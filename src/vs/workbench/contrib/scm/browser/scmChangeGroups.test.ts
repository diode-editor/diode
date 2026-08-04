import { describe, expect, it } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";

import type { IScmChange, ScmGroupId } from "./changesService.ts";
import { groupChanges } from "./scmChangeGroups.ts";

function change(rel: string, group: ScmGroupId): IScmChange {
    return {
        uri: Uri.file(`/repo/${rel}`),
        status: "M",
        colorId: "gitDecoration.modifiedResourceForeground",
        path: rel,
        group,
    };
}

describe("groupChanges", () => {
    it("раскладывает по группам в порядке VS Code, пустые группы опущены", () => {
        const groups = groupChanges([
            change("b.ts", "worktree"),
            change("a.ts", "index"),
            change("c.ts", "untracked"),
        ]);

        expect(groups.map((g) => [g.id, g.label, g.changes.length])).toEqual([
            ["index", "Staged Changes", 1],
            ["worktree", "Changes", 1],
            ["untracked", "Untracked Changes", 1],
        ]);
    });

    it("merge — первой группой, порядок записей внутри группы сохраняется", () => {
        const groups = groupChanges([
            change("z.ts", "worktree"),
            change("a.ts", "worktree"),
            change("conflict.ts", "merge"),
        ]);

        expect(groups[0].id).toBe("merge");
        expect(groups[0].label).toBe("Merge Changes");
        expect(groups[1].changes.map((c) => c.path)).toEqual(["z.ts", "a.ts"]);
    });

    it("пустой снимок — пустой список групп", () => {
        expect(groupChanges([])).toEqual([]);
    });
});
