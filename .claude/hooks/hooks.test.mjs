// Тесты проектных хуков: `node --test .claude/hooks/`.
// Хуки живут вне src/ и в общий vitest-прогон не входят — они не код редактора.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { checkBash } from "./bash-guard.mjs";
import { checkEdit } from "./edit-guard.mjs";
import { simpleCommands } from "./lib.mjs";
import { checklist } from "./stop-checklist.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function repoWithOrigin(url) {
    const dir = mkdtempSync(path.join(tmpdir(), "hooks-test-"));
    execFileSync("git", ["init", "-q", dir]);
    execFileSync("git", ["-C", dir, "remote", "add", "origin", url]);
    return dir;
}

describe("simpleCommands", () => {
    it("режет цепочки и снимает кавычки и префиксы окружения", () => {
        assert.deepEqual(simpleCommands(`cd x && FOO=1 git push "my remote" b; ls | wc`), [
            ["cd", "x"],
            ["git", "push", "my remote", "b"],
            ["ls"],
            ["wc"],
        ]);
    });
});

describe("bash-guard: test:mutation", () => {
    it("ловит позиционную базу после --", () => {
        const why = checkBash("npm run test:mutation -- origin/main", "/");
        assert.match(why, /test:mutation -- --base origin\/main/);
    });
    it("ловит позиционный и за флагами", () => {
        assert.ok(checkBash("claude-lease run -- npm run test:mutation -- --force HEAD~3", "/"));
    });
    it("пропускает флаги и значение флага базы", () => {
        assert.equal(checkBash("npm run test:mutation", "/"), undefined);
        assert.equal(checkBash("npm run test:mutation -- --scope-only", "/"), undefined);
        assert.equal(checkBash("npm run test:mutation -- --base origin/main --force", "/"), undefined);
        assert.equal(checkBash("npm run test:mutation -- --base=origin/main", "/"), undefined);
    });
});

describe("bash-guard: fetch по URL в refs/remotes", () => {
    it("ловит URL + refspec в refs/remotes без --no-prune", () => {
        const cmd = "git fetch https://github.com/diode-editor/diode.git main:refs/remotes/origin/main";
        assert.match(checkBash(cmd, "/"), /--no-prune/);
        assert.ok(checkBash("git fetch git@github.com:a/b.git +refs/heads/main:refs/remotes/origin/main", "/"));
    });
    it("пропускает именованный remote, --no-prune и refspec не в refs/remotes", () => {
        assert.equal(checkBash("git fetch origin main", "/"), undefined);
        assert.equal(checkBash("git fetch origin main:refs/remotes/origin/main", "/"), undefined);
        assert.equal(
            checkBash("git fetch --no-prune https://github.com/a/b.git main:refs/remotes/origin/main", "/"),
            undefined,
        );
        assert.equal(checkBash("git fetch https://github.com/a/b.git main", "/"), undefined);
    });
});

describe("bash-guard: push по ssh", () => {
    it("ловит push на ssh-origin (явный и неявный remote)", () => {
        const dir = repoWithOrigin("git@github.com:diode-editor/diode.git");
        try {
            assert.match(checkBash("git push origin my-branch", dir), /https:\/\/github\.com\/diode-editor/);
            assert.ok(checkBash("git push", dir));
            assert.ok(checkBash(`git -C ${dir} push -u origin b`, "/"));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
    it("ловит явный ssh-URL", () => {
        assert.ok(checkBash("git push git@github.com:diode-editor/diode.git b", "/"));
    });
    it("пропускает https-URL и https-remote", () => {
        assert.equal(checkBash("git push https://github.com/diode-editor/diode.git b", "/"), undefined);
        const dir = repoWithOrigin("https://github.com/diode-editor/diode.git");
        try {
            assert.equal(checkBash("git push origin b", dir), undefined);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
    it("неизвестный remote — пропуск, а не отказ", () => {
        assert.equal(checkBash("git push nope b", "/"), undefined);
    });
});

describe("edit-guard", () => {
    const wt = "/r/.claude/worktrees/foo";
    it("ловит правку основного checkout из worktree и подсказывает путь", () => {
        const why = checkEdit("/r/src/a.ts", wt);
        assert.match(why, /основной checkout/);
        assert.match(why, /\/r\/\.claude\/worktrees\/foo\/src\/a\.ts/);
    });
    it("ловит правку соседнего worktree", () => {
        assert.match(checkEdit("/r/.claude/worktrees/bar/src/a.ts", `${wt}/src`), /соседний worktree «bar»/);
    });
    it("пропускает свой worktree, файлы вне репо и сессию не в worktree", () => {
        assert.equal(checkEdit(`${wt}/src/a.ts`, wt), undefined);
        assert.equal(checkEdit("src/a.ts", wt), undefined);
        assert.equal(checkEdit("/home/u/.claude/projects/x/memory/a.md", wt), undefined);
        assert.equal(checkEdit("/r/src/a.ts", "/r"), undefined);
    });
});

describe("stop-checklist", () => {
    const ran = `{"type":"tool_use","input":{"command":"claude-lease run -- npm run lint"}}`;
    it("пустой, когда всё закрыто", () => {
        const items = checklist({ files: ["src/a.ts"], subjects: ["fix(x): y"], transcript: ran });
        assert.deepEqual(items, []);
    });
    it("линт/типы: упоминание в тексте не считается запуском", () => {
        const items = checklist({ files: ["src/a.ts"], subjects: [], transcript: "прогоняй npm run lint" });
        assert.deepEqual(
            items.map((i) => i.id),
            ["static"],
        );
    });
    it("линт/типы: без кода в диффе не напоминаем", () => {
        assert.deepEqual(checklist({ files: ["docs/a.md"], subjects: [], transcript: "" }), []);
    });
    it("feat без сценария и d.ts без матрицы", () => {
        const items = checklist({
            files: ["src/vscode-dts/vscode.d.ts"],
            subjects: ["feat(api): x"],
            transcript: ran,
        });
        assert.deepEqual(
            items.map((i) => i.id),
            ["scenario", "api-coverage"],
        );
        const ok = checklist({
            files: ["src/vscode-dts/vscode.d.ts", "docs/public/API-COVERAGE.md", "e2e/scenarios/x.scenario.ts"],
            subjects: ["feat(api)!: x"],
            transcript: ran,
        });
        assert.deepEqual(ok, []);
    });
});

describe("протокол: любой сбой — пропуск", () => {
    for (const hook of ["bash-guard.mjs", "edit-guard.mjs", "stop-checklist.mjs"]) {
        it(`${hook}: битый stdin → exit 0`, () => {
            const r = spawnSync(process.execPath, [path.join(here, hook)], { input: "{не json" });
            assert.equal(r.status, 0);
        });
        it(`${hook}: cwd не репозиторий → exit 0`, () => {
            const input = JSON.stringify({
                tool_name: "Bash",
                tool_input: { command: "git push", file_path: "/x" },
                cwd: "/",
                session_id: "s",
            });
            const r = spawnSync(process.execPath, [path.join(here, hook)], { input });
            assert.equal(r.status, 0);
        });
    }
    it("bash-guard: отказ — exit 2 и текст в stderr", () => {
        const input = JSON.stringify({ tool_name: "Bash", tool_input: { command: "npm run test:mutation -- main" } });
        const r = spawnSync(process.execPath, [path.join(here, "bash-guard.mjs")], { input, encoding: "utf8" });
        assert.equal(r.status, 2);
        assert.match(r.stderr, /не база гейта/);
    });
});
