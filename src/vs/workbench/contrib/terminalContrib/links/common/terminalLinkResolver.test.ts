import { describe, expect, it } from "vitest";

import { type FakeDisk, fakeFileService } from "../../../../../../TestUtils/terminalLinks.ts";
import { OperatingSystem } from "../../../../../base/common/platform.ts";
import { Uri } from "../../../../../base/common/uri.ts";

import { type ITerminalLinkResolverContext, TerminalLinkResolver } from "./terminalLinkResolver.ts";

function resolverOver(
    disk: FakeDisk,
    context: Partial<ITerminalLinkResolverContext> = {},
): { resolver: TerminalLinkResolver; stats: string[]; clock: { now: number } } {
    const stats: string[] = [];
    const clock = { now: 1000 };
    const resolver = new TerminalLinkResolver(
        fakeFileService(disk, stats),
        {
            os: OperatingSystem.Linux,
            userHome: "/home/user",
            getCwds: () => Promise.resolve(["/ws"]),
            ...context,
        },
        () => clock.now,
    );
    return { resolver, stats, clock };
}

describe("TerminalLinkResolver", () => {
    it("strips the line/column suffix and the query string before the stat", async () => {
        const { resolver } = resolverOver({ "/ws": "dir", "/ws/a.ts": "file" });
        const resolved = await resolver.resolveLink("a.ts:3:4");
        expect(resolved).toMatchObject({ link: "a.ts:3:4", isDirectory: false });
        expect(resolved?.uri.toString()).toBe("file:///ws/a.ts");
        expect((await resolver.resolveLink("a.ts?x=1"))?.uri.fsPath).toBe("/ws/a.ts");
        expect(await resolver.resolveLink(":3")).toBeNull();
    });

    it("tries the bases in order and takes the first existing one", async () => {
        const { resolver, stats } = resolverOver(
            { "/b/a.ts": "file", "/c/a.ts": "file" },
            { getCwds: () => Promise.resolve(["/a", "/b", "/c"]) },
        );
        expect((await resolver.resolveLink("a.ts"))?.uri.fsPath).toBe("/b/a.ts");
        expect(stats).toEqual(["/a/a.ts", "/b/a.ts"]);
    });

    it("normalizes `..` and `.` segments", async () => {
        const { resolver } = resolverOver({ "/a.ts": "file" });
        expect((await resolver.resolveLink("../x/./../a.ts"))?.uri.fsPath).toBe("/a.ts");
        expect((await resolver.resolveLink("/ws/../a.ts"))?.uri.fsPath).toBe("/a.ts");
    });

    it("expands `~` to the home folder, and without a home a `~` path is not a link", async () => {
        const disk: FakeDisk = { "/home/user/a.ts": "file" };
        expect((await resolverOver(disk).resolver.resolveLink("~/a.ts"))?.uri.fsPath).toBe("/home/user/a.ts");
        const homeless = resolverOver(disk, { userHome: undefined });
        expect(await homeless.resolver.resolveLink("~/a.ts")).toBeNull();
        expect(homeless.stats).toEqual([]);
    });

    it("reports a directory as such", async () => {
        const { resolver } = resolverOver({ "/ws/src": "dir" });
        expect((await resolver.resolveLink("src"))?.isDirectory).toBe(true);
    });

    it("a given uri is stat-ed as is", async () => {
        const { resolver } = resolverOver({ "/x y/a.ts": "file" });
        const uri = Uri.parse("file:///x%20y/a.ts");
        expect(await resolver.resolveLink("file:///x%20y/a.ts", uri)).toEqual({
            uri,
            link: "file:///x%20y/a.ts",
            isDirectory: false,
        });
        expect(await resolver.resolveLink("file:///none", Uri.parse("file:///none"))).toBeNull();
    });

    it("caches hits and misses by absolute path until 10s after the last write", async () => {
        const disk: Record<string, "file"> = {};
        const { resolver, stats, clock } = resolverOver(disk);
        expect(await resolver.resolveLink("a.ts")).toBeNull();
        disk["/ws/a.ts"] = "file";
        clock.now += 9_999;
        expect(await resolver.resolveLink("./a.ts:5")).toBeNull();
        expect(stats).toEqual(["/ws/a.ts"]);

        clock.now += 1;
        expect(await resolver.resolveLink("a.ts:7")).toMatchObject({ link: "a.ts:7" });
        expect(stats).toEqual(["/ws/a.ts", "/ws/a.ts"]);
        expect(await resolver.resolveLink("a.ts:8")).toMatchObject({ link: "a.ts:8" });
        expect(stats).toHaveLength(2);
    });

    it("the same relative text after `cd` is another file", async () => {
        let cwd = "/one";
        const { resolver } = resolverOver(
            { "/one/a.ts": "file", "/two/a.ts": "file" },
            { getCwds: () => Promise.resolve([cwd]) },
        );
        expect((await resolver.resolveLink("a.ts"))?.uri.fsPath).toBe("/one/a.ts");
        cwd = "/two";
        expect((await resolver.resolveLink("a.ts"))?.uri.fsPath).toBe("/two/a.ts");
    });

    describe("Windows", () => {
        const windows = { os: OperatingSystem.Windows, userHome: "C:\\Users\\u" } as const;

        it("drive and `\\\\?\\` paths are absolute; relative ones join the cwd", async () => {
            const stats: string[] = [];
            const resolver = new TerminalLinkResolver(fakeFileService({}, stats), {
                ...windows,
                getCwds: () => Promise.resolve(["C:\\ws"]),
            });
            await resolver.resolveLink("c:\\foo\\a.ts");
            await resolver.resolveLink("\\\\?\\C:\\foo\\b.ts");
            await resolver.resolveLink("src\\c.ts");
            await resolver.resolveLink("~\\d.ts");
            // The `\\?\` prefix goes, with or without a drive after it.
            await resolver.resolveLink("\\\\?\\UNC\\srv\\e.ts");
            expect(stats).toEqual([
                Uri.file("c:\\foo\\a.ts").fsPath,
                Uri.file("C:\\foo\\b.ts").fsPath,
                Uri.file("C:\\ws\\src\\c.ts").fsPath,
                Uri.file("C:\\Users\\u\\d.ts").fsPath,
                Uri.file("UNC\\srv\\e.ts").fsPath,
            ]);
        });
    });
});
