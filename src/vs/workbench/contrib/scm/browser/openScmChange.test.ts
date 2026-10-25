import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import type { IDiffSideSpec, IOpenDiffPairOptions } from "../../diff/browser/openDiffPair.ts";

import type { ScmGroupId } from "./changesService.ts";
import { buildChangePairOptions, INDEX_REF, openScmChange } from "./openScmChange.ts";
import { OriginalResourceProviderDIToken } from "./quickDiffService.ts";

// Here: the pair per group and status; the frame (titles, sides, refresh) is in workbench.changes.test.ts.

const FILE = Uri.file("/repo/src/a.ts");
const gitUri = (ref: string): Uri => Uri.from({ scheme: "git", path: FILE.path, query: JSON.stringify({ ref }) });

function accessorWith(provide: (uri: Uri, ref: string) => Uri | null): {
    accessor: ServiceAccessor;
    openUri: ReturnType<typeof vi.fn>;
} {
    const openUri = vi.fn();
    const services = new Map<unknown, unknown>([
        [OriginalResourceProviderDIToken, { provideOriginalResource: (uri: Uri, ref: string) => provide(uri, ref) }],
        [EditorServiceDIToken, { openUri }],
    ]);
    const accessor = { get: (token: unknown) => services.get(token) } as unknown as ServiceAccessor;
    return { accessor, openUri };
}

/** Uris as strings: a `Uri` caches its formatted form, so equal uris are not deeply equal. */
function plain(options: IOpenDiffPairOptions | null): unknown {
    if (options === null) return null;
    const side = (s: IDiffSideSpec) => ({ ...s, uri: s.uri?.toString() });
    return { ...options, original: side(options.original), modified: side(options.modified) };
}

const git = () => accessorWith((_uri, ref) => gitUri(ref)).accessor;
const change = (group: ScmGroupId, status = "M") => ({ uri: FILE, status, group });

describe("buildChangePairOptions", () => {
    it("Changes: the index on the left, the working tree file on the right", async () => {
        expect(plain(await buildChangePairOptions(git(), change("worktree")))).toEqual({
            original: { uri: gitUri(INDEX_REF).toString(), label: "Index", identity: gitUri(INDEX_REF).toString() },
            modified: { uri: FILE.toString(), label: "a.ts", identity: FILE.toString(), onMissing: "empty" },
            title: "a.ts (Working Tree)",
        });
    });

    it("Staged: HEAD on the left, the index on the right", async () => {
        expect(plain(await buildChangePairOptions(git(), change("index")))).toEqual({
            original: {
                uri: gitUri("HEAD").toString(),
                label: "HEAD",
                identity: gitUri("HEAD").toString(),
                onMissing: "error",
            },
            modified: {
                uri: gitUri(INDEX_REF).toString(),
                label: "Index",
                identity: gitUri(INDEX_REF).toString(),
                onMissing: "empty",
            },
            title: "a.ts (Index)",
        });
    });

    it("a staged new file has nothing at HEAD: the left side is empty, not an error", async () => {
        const options = await buildChangePairOptions(git(), change("index", "A"));
        expect(options?.original.onMissing).toBe("empty");
        expect(options?.title).toBe("a.ts (Index)");
    });

    it("a deletion in either group is titled (Deleted)", async () => {
        expect((await buildChangePairOptions(git(), change("worktree", "D")))?.title).toBe("a.ts (Deleted)");
        expect((await buildChangePairOptions(git(), change("index", "D")))?.title).toBe("a.ts (Deleted)");
    });

    it("untracked and conflicted files have no pair and ask git for nothing", async () => {
        const provide = vi.fn(() => gitUri("HEAD"));
        const { accessor } = accessorWith(provide);

        expect(await buildChangePairOptions(accessor, change("untracked", "U"))).toBeNull();
        expect(await buildChangePairOptions(accessor, change("merge", "U"))).toBeNull();
        expect(provide).not.toHaveBeenCalled();
    });

    it("no git, a missing HEAD or a throwing provider: no pair", async () => {
        const noIndex = accessorWith((_uri, ref) => (ref === INDEX_REF ? null : gitUri(ref))).accessor;
        expect(await buildChangePairOptions(noIndex, change("worktree"))).toBeNull();

        const noHead = accessorWith((_uri, ref) => (ref === "HEAD" ? null : gitUri(ref))).accessor;
        expect(await buildChangePairOptions(noHead, change("index"))).toBeNull();

        const throwing = accessorWith(() => {
            throw new Error("git exploded");
        }).accessor;
        expect(await buildChangePairOptions(throwing, change("worktree"))).toBeNull();
    });
});

describe("openScmChange", () => {
    it("without a pair opens the file itself", async () => {
        const { accessor, openUri } = accessorWith(() => gitUri("HEAD"));

        await openScmChange(accessor, change("merge", "U"));

        expect(openUri).toHaveBeenCalledWith(FILE);
    });
});
