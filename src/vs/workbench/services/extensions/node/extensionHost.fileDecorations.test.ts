import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IDecoration } from "../../decorations/common/decorations.ts";
import { DecorationsService } from "../../decorations/common/decorationsService.ts";

const WAIT = { timeout: 5000, interval: 20 };

/** Providers of a real subprocess, asked by a real decorations service, as the explorer asks it. */
describe("ExtensionHost — file decorations on request (subprocess)", () => {
    let harness: IExtensionHarness;
    let service: DecorationsService;

    async function start(): Promise<void> {
        service = new DecorationsService();
        harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.files", "decoratesFilesOnRequest.cjs")],
            fileDecorations: service,
        });
    }

    afterEach(async () => {
        await harness.dispose();
        service.dispose();
    });

    const run = async (command: string, ...args: unknown[]): Promise<unknown> =>
        await harness.commandRegistry.execute(command, ...args);
    const uriOf = (relative: string): Uri => Uri.file(path.join(harness.tmpDir, relative));

    /** Asks as a row draw would, until the answer satisfies `check`. */
    async function decorationOf(
        uri: Uri,
        check: (decoration: IDecoration | undefined) => boolean,
        includeChildren = false,
    ): Promise<IDecoration | undefined> {
        return vi.waitFor(() => {
            const decoration = service.getDecoration(uri, includeChildren);
            expect(check(decoration), JSON.stringify(decoration)).toBe(true);
            return decoration;
        }, WAIT);
    }

    it("(a) a provider without an event answers when asked", async () => {
        await start();
        await run("test.files.register", "pull", false);
        const a = uriOf("src/a.pull");
        await run("test.files.answer", "pull", a.toString(), {
            badge: "P",
            tooltip: "pulled",
            color: "charts.red",
            propagate: true,
        });

        expect(await decorationOf(a, (d) => d !== undefined)).toEqual({
            badge: "P",
            color: "charts.red",
            tooltip: "pulled",
        });
        expect(service.getDecoration(uriOf("src"), true)?.badge).toBe("●");
    });

    it("(b) fire(undefined): the shown resources are asked again and the new answer draws", async () => {
        await start();
        await run("test.files.register", "p", true);
        const f = uriOf("f.txt");
        await run("test.files.answer", "p", f.toString(), { badge: "1" });
        await decorationOf(f, (d) => d?.badge === "1");

        await run("test.files.answer", "p", f.toString(), { badge: "2" });
        await run("test.files.fire", "p");
        await decorationOf(f, (d) => d?.badge === "2");
        expect(((await run("test.files.asked", "p")) as string[]).filter((uri) => uri === f.toString())).toHaveLength(
            2,
        );
    });

    it("(c) fire([uri]) of a file nobody shows marks its collapsed folder, as git does", async () => {
        await start();
        await run("test.files.register", "git", true);
        const hidden = uriOf("pkg/deep/hidden.ts");
        await run("test.files.answer", "git", hidden.toString(), { badge: "M", propagate: true });
        await run("test.files.fire", "git", [hidden.toString()]);
        await decorationOf(uriOf("pkg"), (d) => d?.badge === "●", true);
    });

    it("(d) dispose: the decoration goes", async () => {
        await start();
        await run("test.files.register", "p", false);
        const f = uriOf("f.txt");
        await run("test.files.answer", "p", f.toString(), { badge: "D" });
        await decorationOf(f, (d) => d?.badge === "D");

        await run("test.files.dispose", "p");
        await decorationOf(f, (d) => d === undefined);
    });

    it("(e) a restart of the subprocess takes the dead spawn's decorations off", async () => {
        await start();
        await run("test.files.register", "p", false);
        const f = uriOf("f.txt");
        await run("test.files.answer", "p", f.toString(), { badge: "E", propagate: true });
        await decorationOf(f, (d) => d?.badge === "E");

        await harness.host.restartForWorkspaceChange();
        expect(service.getDecoration(f, false)).toBeUndefined();
        expect(service.getDecoration(uriOf(""), true)).toBeUndefined();
    });

    it("(f) two providers on one file: 'A, B', the newer one's color", async () => {
        await start();
        const f = uriOf("f.txt");
        await run("test.files.register", "b", false);
        await run("test.files.register", "a", false);
        await run("test.files.answer", "b", f.toString(), { badge: "B", color: "charts.blue" });
        await run("test.files.answer", "a", f.toString(), { badge: "A", color: "charts.red" });
        expect(await decorationOf(f, (d) => d?.badge === "A, B")).toMatchObject({ color: "charts.red" });
    });

    it("(g) a throwing provider doesn't break its neighbor", async () => {
        await start();
        const f = uriOf("f.txt");
        await run("test.files.register", "ok", false);
        await run("test.files.register", "broken", false);
        await run("test.files.answer", "broken", f.toString(), "throw");
        await run("test.files.answer", "ok", f.toString(), { badge: "K" });
        await decorationOf(f, (d) => d?.badge === "K");
    });

    it("(h) an invalid badge 'ABC' is dropped; the provider's valid answers stay", async () => {
        await start();
        const bad = uriOf("bad.txt");
        const good = uriOf("good.txt");
        await run("test.files.register", "p", false);
        await run("test.files.answer", "p", bad.toString(), { badge: "ABC" });
        await run("test.files.answer", "p", good.toString(), { badge: "10" });
        service.getDecoration(bad, false);
        await decorationOf(good, (d) => d?.badge === "10");
        expect(service.getDecoration(bad, false)).toBeUndefined();
    });

    it("(k) a uri with a query is decorated apart from the same path without it", async () => {
        await start();
        const plain = uriOf("dep.jar");
        const conflict = plain.with({ authority: "maven", query: "hasConflict" });
        await run("test.files.register", "maven", false);
        await run("test.files.answer", "maven", conflict.toString(), { badge: "C", color: "list.warningForeground" });
        expect(await decorationOf(conflict, (d) => d !== undefined)).toMatchObject({ badge: "C" });
        service.getDecoration(plain, false);
        await vi.waitFor(async () => {
            expect(((await run("test.files.asked", "maven")) as string[]).includes(plain.toString())).toBe(true);
        }, WAIT);
        expect(service.getDecoration(plain, false)).toBeUndefined();
    });
});
