import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    ensureGopls,
    findGoBinary,
    GO_LANGUAGE_SERVICE,
    GO_SAMPLE_DIR,
    goSampleFiles,
    goToolchainMissing,
} from "./goFixture.ts";

// The network part (`installGo`, a real gopls build) is covered by the extensionHost.goLsp* suites.

const SKIP_REASON = "Go toolchain not found in PATH — golang.go suites skipped (CI installs it via actions/setup-go)";

describe("goFixture — language service", () => {
    it(".go gets the go language, anything else undefined", () => {
        expect(GO_LANGUAGE_SERVICE.getLanguageIdForResource("/tmp/main.go")).toBe("go");
        // If the service tagged go.mod as `go`, the extension would get didOpen for a module file.
        expect(GO_LANGUAGE_SERVICE.getLanguageIdForResource("/tmp/go.mod")).toBeUndefined();
    });
});

describe("goFixture — sample project", () => {
    it("lists every file of the sample by its root-relative path with forward slashes", () => {
        const files = goSampleFiles();
        expect(Object.keys(files).sort()).toEqual(["go.mod", "greet/greet.go", "greet/greet_test.go", "main.go"]);
        expect(files["main.go"]).toBe(fs.readFileSync(path.join(GO_SAMPLE_DIR, "main.go"), "utf-8"));
    });
});

describe("goFixture — Go detection", () => {
    let root = "";

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "diode-go-detect-"));
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("the first PATH entry with `go` wins; an empty entry is skipped", () => {
        const first = path.join(root, "first");
        const second = path.join(root, "second");
        fs.mkdirSync(first);
        fs.mkdirSync(second);
        fs.writeFileSync(path.join(second, "go"), "");
        const PATH = ["", first, second].join(path.delimiter);
        expect(findGoBinary({ PATH }, "linux")).toBe(path.join(second, "go"));
        expect(goToolchainMissing({ PATH }, "linux")).toBeUndefined();
    });

    it("no `go` on PATH, or no PATH at all, is no toolchain, and the suites get their skip reason", () => {
        expect(findGoBinary({ PATH: root }, "linux")).toBeUndefined();
        expect(findGoBinary({}, "linux")).toBeUndefined();
        expect(goToolchainMissing({ PATH: root }, "linux")).toBe(SKIP_REASON);
    });

    it("`go.exe` counts only on windows", () => {
        fs.writeFileSync(path.join(root, "go.exe"), "");
        expect(findGoBinary({ PATH: root }, "linux")).toBeUndefined();
        expect(findGoBinary({ PATH: root }, "win32")).toBe(path.join(root, "go.exe"));
        expect(goToolchainMissing({ PATH: root }, "win32")).toBeUndefined();
    });

    it("without arguments it looks at this process's PATH", () => {
        const name = process.platform === "win32" ? "go.exe" : "go";
        fs.writeFileSync(path.join(root, name), "");
        vi.stubEnv("PATH", root);
        expect(findGoBinary()).toBe(path.join(root, name));
        expect(goToolchainMissing()).toBeUndefined();
    });
});

describe.skipIf(process.platform === "win32")("goFixture — gopls", () => {
    let root = "";
    const toolsDir = (): string => path.join(root, "tools", "diode-go-fixture");
    const builtGopls = (): string => path.join(toolsDir(), "bin", "gopls");

    /** A `go` that "installs" an empty gopls into `GOBIN` and records its arguments. */
    const fakeGo = (options: { readonly alsoInstallInto?: string } = {}): NodeJS.ProcessEnv => {
        const bin = path.join(root, "go-bin");
        fs.mkdirSync(bin);
        const script = path.join(bin, "go");
        const rival = options.alsoInstallInto;
        fs.writeFileSync(
            script,
            [
                "#!/bin/sh",
                `printf '%s\\n' "$@" > '${path.join(root, "args")}'`,
                'mkdir -p "$GOBIN" && : > "$GOBIN/gopls"',
                ...(rival === undefined
                    ? []
                    : [`mkdir -p '${path.join(rival, "bin")}' && : > '${path.join(rival, "bin", "gopls")}'`]),
                "exit 0",
                "",
            ].join("\n"),
        );
        fs.chmodSync(script, 0o755);
        // The script needs `mkdir` and `printf` from the machine; the fake `go` comes first.
        return { PATH: [bin, process.env.PATH ?? ""].join(path.delimiter) };
    };

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "diode-gopls-"));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("a cached gopls is returned without running go", () => {
        fs.mkdirSync(path.dirname(builtGopls()), { recursive: true });
        fs.writeFileSync(builtGopls(), "");
        expect(ensureGopls(toolsDir(), { PATH: root }, "linux")).toBe(builtGopls());
        expect(fs.existsSync(path.join(root, "args"))).toBe(false);
    });

    it("without go the build cannot start, and the error is the suites' skip reason", () => {
        expect(() => ensureGopls(toolsDir(), { PATH: root }, "linux")).toThrow(SKIP_REASON);
        expect(fs.existsSync(path.dirname(toolsDir()))).toBe(false);
    });

    it("builds gopls into a staging directory and moves it into place", () => {
        const gopls = ensureGopls(toolsDir(), fakeGo(), "linux");
        expect(gopls).toBe(builtGopls());
        expect(fs.existsSync(gopls)).toBe(true);
        expect(fs.readFileSync(path.join(root, "args"), "utf-8")).toBe("install\ngolang.org/x/tools/gopls@latest\n");
        // No staging directory is left behind next to the tools.
        expect(fs.readdirSync(path.dirname(toolsDir()))).toEqual(["diode-go-fixture"]);
    });

    it("a parallel worker that finished first keeps its build; the staging copy is removed", () => {
        const gopls = ensureGopls(toolsDir(), fakeGo({ alsoInstallInto: toolsDir() }), "linux");
        expect(gopls).toBe(builtGopls());
        expect(fs.existsSync(gopls)).toBe(true);
        expect(fs.readdirSync(path.dirname(toolsDir()))).toEqual(["diode-go-fixture"]);
    });
});
