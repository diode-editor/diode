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
    it("splits into groups in VS Code order, empty groups are omitted", () => {
        const groups = groupChanges([change("b.ts", "worktree"), change("a.ts", "index"), change("c.ts", "untracked")]);

        expect(groups.map((g) => [g.id, g.label, g.changes.length])).toEqual([
            ["index", "Staged Changes", 1],
            ["worktree", "Changes", 2],
        ]);
    });

    it("untracked is shown under the Changes header while keeping its own group in the entry", () => {
        const groups = groupChanges([change("new.ts", "untracked"), change("edited.ts", "worktree")]);

        expect(groups).toHaveLength(1);
        expect(groups[0].label).toBe("Changes");
        // The entry remembers its real group — discard uses it to pick clean vs checkout.
        expect(groups[0].changes.map((c) => c.group)).toEqual(["untracked", "worktree"]);
    });

    it("merge comes first, entry order within a group is preserved", () => {
        const groups = groupChanges([
            change("z.ts", "worktree"),
            change("a.ts", "worktree"),
            change("conflict.ts", "merge"),
        ]);

        expect(groups[0].id).toBe("merge");
        expect(groups[0].label).toBe("Merge Changes");
        expect(groups[1].changes.map((c) => c.path)).toEqual(["z.ts", "a.ts"]);
    });

    it("an empty snapshot gives an empty group list", () => {
        expect(groupChanges([])).toEqual([]);
    });
});
