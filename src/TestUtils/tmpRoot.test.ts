import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    createRunTmpRoot,
    type KillMarked,
    pruneStaleRoots,
    setup,
    setupRunTmpRoot,
    TEMP_ENV_VARS,
} from "./tmpRoot.ts";

describe("tmpRoot — run's temp directory root", () => {
    let parent: string;

    beforeEach(() => {
        parent = fs.mkdtempSync(path.join(os.tmpdir(), "tmproot-case-"));
    });

    afterEach(() => {
        fs.rmSync(parent, { recursive: true, force: true });
    });

    function rootOwnedBy(pid: number): string {
        return createRunTmpRoot(parent, pid);
    }

    describe("createRunTmpRoot", () => {
        it("creates a directory in the parent and marks the owner", () => {
            const root = createRunTmpRoot(parent, 1234);

            expect(path.dirname(root)).toBe(parent);
            expect(fs.readFileSync(path.join(root, "owner.pid"), "utf-8")).toBe("1234");
        });

        it("two roots do not collide", () => {
            expect(createRunTmpRoot(parent)).not.toBe(createRunTmpRoot(parent));
        });
    });

    describe("pruneStaleRoots", () => {
        it("removes a dead owner's root and leaves a live one", () => {
            const dead = rootOwnedBy(1111);
            const alive = rootOwnedBy(2222);
            fs.writeFileSync(path.join(dead, "forgotten.txt"), "junk");

            const removed = pruneStaleRoots(parent, (pid) => pid === 2222);

            expect(removed).toEqual([dead]);
            expect(fs.existsSync(dead)).toBe(false);
            expect(fs.existsSync(alive)).toBe(true);
        });

        it("before removing an orphaned root kills its processes and reports it", () => {
            const dead = rootOwnedBy(1111);
            const alive = rootOwnedBy(2222);
            const killMarked = vi.fn<KillMarked>((root) => (root === dead ? [{ pid: 77, command: "tsserver" }] : []));
            const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
            try {
                pruneStaleRoots(parent, (pid) => pid === 2222, killMarked);

                expect(killMarked.mock.calls).toEqual([[dead]]);
                expect(fs.existsSync(alive)).toBe(true);
                expect(info).toHaveBeenCalledWith(
                    expect.stringMatching(/killed processes of interrupted run .*: 1\n {2}77 tsserver/),
                );
            } finally {
                info.mockRestore();
            }
        });

        it("nothing to kill — stays silent", () => {
            rootOwnedBy(1111);
            const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
            try {
                pruneStaleRoots(
                    parent,
                    () => false,
                    () => [],
                );

                expect(info).not.toHaveBeenCalled();
            } finally {
                info.mockRestore();
            }
        });

        it("a root without an owner mark counts as orphaned", () => {
            const unmarked = fs.mkdtempSync(path.join(parent, "diode-testrun-"));

            expect(pruneStaleRoots(parent, () => true)).toEqual([unmarked]);
        });

        it("a broken owner mark is orphaned too", () => {
            const broken = rootOwnedBy(42);
            fs.writeFileSync(path.join(broken, "owner.pid"), "not a number", "utf-8");

            expect(pruneStaleRoots(parent, () => true)).toEqual([broken]);
        });

        it("a foreign prefix is left alone even without a mark", () => {
            const foreign = fs.mkdtempSync(path.join(parent, "diode-tests-"));
            const alien = fs.mkdtempSync(path.join(parent, "foo-"));

            expect(pruneStaleRoots(parent, () => false)).toEqual([]);
            expect(fs.existsSync(foreign)).toBe(true);
            expect(fs.existsSync(alien)).toBe(true);
        });

        it("a file with our prefix is not a directory, skipped", () => {
            const file = path.join(parent, "diode-testrun-notadir");
            fs.writeFileSync(file, "");

            expect(pruneStaleRoots(parent, () => false)).toEqual([]);
            expect(fs.existsSync(file)).toBe(true);
        });

        it("no parent — empty result, no exception", () => {
            expect(pruneStaleRoots(path.join(parent, "no-such"), () => false)).toEqual([]);
        });

        it.skipIf(process.platform === "win32")("a root that cannot be removed is not reported as removed", () => {
            const stubborn = rootOwnedBy(1111);
            // A real EACCES instead of mocking fs: an ESM module can't be reconfigured.
            fs.chmodSync(parent, 0o500);
            try {
                expect(pruneStaleRoots(parent, () => false)).toEqual([]);
                expect(fs.existsSync(stubborn)).toBe(true);
            } finally {
                fs.chmodSync(parent, 0o700);
            }
        });

        it("foreign owner (EPERM) — treated as alive, not removed", () => {
            const foreign = rootOwnedBy(3333);
            const kill = vi.spyOn(process, "kill").mockImplementation(() => {
                throw Object.assign(new Error("not permitted"), { code: "EPERM" });
            });
            try {
                // No injection: EPERM handling lives in the real isAlive.
                expect(pruneStaleRoots(parent)).toEqual([]);
            } finally {
                kill.mockRestore();
            }
            expect(fs.existsSync(foreign)).toBe(true);
        });

        it("owner gone (ESRCH) — removed", () => {
            const dead = rootOwnedBy(4444);
            const kill = vi.spyOn(process, "kill").mockImplementation(() => {
                throw Object.assign(new Error("no such process"), { code: "ESRCH" });
            });
            try {
                expect(pruneStaleRoots(parent)).toEqual([dead]);
            } finally {
                kill.mockRestore();
            }
        });
    });

    describe("setup (globalSetup vitest)", () => {
        // `stubEnv` remembers the original even if `setup` overwrites the variable directly.
        beforeEach(() => {
            for (const name of [...TEMP_ENV_VARS, "DIODE_TEST_TMP"]) vi.stubEnv(name, process.env[name]);
        });

        afterEach(() => {
            vi.unstubAllEnvs();
            delete process.env.DIODE_TEST_TMP_PARENT;
        });

        it("points TMPDIR at its root, and teardown removes it entirely", () => {
            process.env.DIODE_TEST_TMP_PARENT = parent;

            const teardown = setup();

            const root = process.env.DIODE_TEST_TMP;
            expect(root).toBeDefined();
            expect(TEMP_ENV_VARS.map((name) => process.env[name])).toEqual([root, root, root]);
            expect(path.dirname(fs.mkdtempSync(path.join(os.tmpdir(), "inside-")))).toBe(root);
            fs.writeFileSync(path.join(root!, "forgotten.txt"), "junk");

            teardown();

            expect(fs.existsSync(root!)).toBe(false);
        });

        it("prunes roots of dead runs and reports it", () => {
            process.env.DIODE_TEST_TMP_PARENT = parent;
            // Above any platform's pid ceiling: with 1111 it failed on CI, where such a process is sometimes alive.
            const dead = rootOwnedBy(2 ** 31 - 1);
            const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

            const teardown = setup();
            teardown();

            expect(fs.existsSync(dead)).toBe(false);
            expect(info).toHaveBeenCalledWith(expect.stringContaining("pruned roots"));
            info.mockRestore();
        });

        it("teardown kills the run's processes before removing the root and reports it", () => {
            process.env.DIODE_TEST_TMP_PARENT = parent;
            const seen: { root: string; existed: boolean }[] = [];
            const killMarked = vi.fn<KillMarked>((root) => {
                seen.push({ root, existed: fs.existsSync(root) });
                return [{ pid: 88, command: "diode --headless" }];
            });
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            try {
                const teardown = setupRunTmpRoot(killMarked);
                const root = process.env.DIODE_TEST_TMP!;
                teardown();

                expect(seen).toEqual([{ root, existed: true }]);
                expect(warn).toHaveBeenCalledWith(
                    expect.stringMatching(/killed processes that outlived the run: 1\n {2}88 diode --headless/),
                );
                expect(fs.existsSync(root)).toBe(false);
            } finally {
                warn.mockRestore();
            }
        });

        it("teardown without survivors stays silent", () => {
            process.env.DIODE_TEST_TMP_PARENT = parent;
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            try {
                setupRunTmpRoot(() => [])();

                expect(warn).not.toHaveBeenCalled();
            } finally {
                warn.mockRestore();
            }
        });

        it("nothing to prune — stays silent", () => {
            process.env.DIODE_TEST_TMP_PARENT = parent;
            const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

            const teardown = setup();
            teardown();

            expect(info).not.toHaveBeenCalled();
            info.mockRestore();
        });

        it("without DIODE_TEST_TMP_PARENT the root goes into the system tmp", () => {
            const outer = os.tmpdir();

            const teardown = setup();
            try {
                expect(path.dirname(process.env.DIODE_TEST_TMP!)).toBe(outer);
            } finally {
                teardown();
            }
        });
    });
});
