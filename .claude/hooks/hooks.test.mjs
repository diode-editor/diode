// Тесты проектных хуков: `node --test .claude/hooks/hooks.test.mjs`; в CI — в составе
// `npm run test:scripts`. Хуки живут вне src/ и в общий vitest-прогон не входят —
// они не код редактора.
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
    it("операторы в кавычках команду не режут", () => {
        assert.deepEqual(simpleCommands(`git commit -m "a; b | c && d" -m 'e || f\ng'`), [
            ["git", "commit", "-m", "a; b | c && d", "-m", "e || f\ng"],
        ]);
        assert.deepEqual(simpleCommands(`echo "a \\"b\\" c" d\\ e`), [["echo", `a "b" c`, "d e"]]);
    });
    it("редиректы — не слова команды", () => {
        assert.deepEqual(simpleCommands("git push 2>&1 | tail -5"), [
            ["git", "push"],
            ["tail", "-5"],
        ]);
        assert.deepEqual(simpleCommands("a >out 2>/dev/null; b > out 2> err < in; c &>log; d >>log 2>&1 &"), [
            ["a"],
            ["b"],
            ["c"],
            ["d"],
        ]);
        assert.deepEqual(simpleCommands("grep x <<< text y; echo 2 > f"), [
            ["grep", "x", "y"],
            ["echo", "2"],
        ]);
    });
    it("подстановка — одно непрозрачное слово, скобки и перенос строки режут", () => {
        assert.deepEqual(simpleCommands('a --base $(git merge-base HEAD "origin/main") b `c d`'), [
            ["a", "--base", '$(git merge-base HEAD "origin/main")', "b", "`c d`"],
        ]);
        assert.deepEqual(simpleCommands("(cd x && ls)\necho \\\n  y # хвост; z"), [["cd", "x"], ["ls"], ["echo", "y"]]);
    });
    it("тело heredoc — данные, а не команды", () => {
        const body = "git push git@github.com:a/b.git c\nEOF не конец\n";
        assert.deepEqual(simpleCommands(`cat > f <<'EOF' && ls\n${body}EOF\nwc -l f`), [
            ["cat"],
            ["ls"],
            ["wc", "-l", "f"],
        ]);
        assert.deepEqual(simpleCommands(`cat <<-X\n\tтекст\n\tX\nls`), [["cat"], ["ls"]]);
        const subst = `$(cat <<'EOF'\nкавычка " и ; тут\nEOF\n)`;
        assert.deepEqual(simpleCommands(`gh pr create --body "${subst}" --draft`), [
            ["gh", "pr", "create", "--body", subst, "--draft"],
        ]);
    });
});

describe("bash-guard: test:mutation", () => {
    const run = "npm run test:mutation --";
    it("ловит позиционную базу после --", () => {
        const why = checkBash(`${run} origin/main`, "/");
        assert.match(why, /test:mutation -- --base origin\/main/);
        assert.match(checkBash(`${run} feature`, "/"), /Позиционный аргумент «feature»/);
    });
    it("ловит позиционный и за флагами, обёртками и перед пайпом", () => {
        assert.ok(checkBash(`claude-lease run -- ${run} --force HEAD~3`, "/"));
        assert.match(checkBash(`${run} --incremental feature`, "/"), /--base feature/);
        assert.match(checkBash(`timeout 600 ${run} --concurrency=4 feature 2>&1 | tail -5`, "/"), /--base feature/);
        assert.match(checkBash(`cd x && claude-lease run -- timeout 600 ${run} feature > log`, "/"), /--base feature/);
    });
    it("пропускает флаги и значение флага базы", () => {
        assert.equal(checkBash("npm run test:mutation", "/"), undefined);
        assert.equal(checkBash(`${run} --scope-only`, "/"), undefined);
        assert.equal(checkBash(`${run} --base origin/main --force`, "/"), undefined);
        assert.equal(checkBash(`${run} --base=origin/main`, "/"), undefined);
        assert.equal(checkBash(`${run} --base $(git merge-base HEAD origin/main)`, "/"), undefined);
    });
    it("значение любого флага — не позиционный", () => {
        // Первые два — отказы из сессии #556, с которых началась эта починка.
        const file = "src/vs/base/common/strings.test.ts";
        assert.equal(checkBash(`claude-lease run -- ${run} --testFiles ${file}`, "/"), undefined);
        assert.equal(
            checkBash(`claude-lease run -- ${run} --testFiles=${file} 2>&1 | grep -v DEBUG | tail -60`, "/"),
            undefined,
        );
        assert.equal(checkBash(`${run} --concurrency 4 --mutate "src/a.ts" --reporters json`, "/"), undefined);
        assert.equal(
            checkBash(`${run} --verify-jobs 2 --verify-timeout 90 --verify-budget 10 --verify-full`, "/"),
            undefined,
        );
        assert.equal(checkBash(`${run} --since origin/main -c 2`, "/"), undefined);
    });
    it("редиректы, пайпы и цепочки после команды — не аргументы", () => {
        const wrapped = `claude-lease run -- timeout 600 ${run} --base origin/main`;
        const tails = ["2>&1", "> /tmp/log 2>&1", ">/tmp/log", "2>/dev/null | tail", "&> log &", "|| true", "; echo ok"];
        for (const tail of tails) {
            assert.equal(checkBash(`${wrapped} ${tail}`, "/"), undefined, tail);
        }
        assert.equal(checkBash(`${run} --scope-only\necho готово`, "/"), undefined);
    });
    it("упоминание в кавычках и heredoc — текст, а не запуск", () => {
        assert.equal(checkBash(`git commit -m "fix: теперь; ${run} feature"`, "/"), undefined);
        assert.equal(checkBash(`gh pr create --body "$(cat <<'EOF'\n    ${run} feature\nEOF\n)"`, "/"), undefined);
        assert.equal(checkBash(`cat > notes.md <<'EOF'\n${run} feature\nEOF`, "/"), undefined);
    });
    it("прочие ошибки аргументов оставляет гейту", () => {
        assert.equal(checkBash(`${run} --verify-jobs много`, "/"), undefined);
        assert.equal(checkBash(`${run} --base`, "/"), undefined);
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
    it("редирект после команды вердикт не меняет", () => {
        const cmd = "git fetch https://github.com/a/b.git main:refs/remotes/origin/main";
        assert.ok(checkBash(`${cmd} 2>&1 | tail -3`, "/"));
        assert.equal(checkBash(`${cmd} --no-prune 2>&1 | tail -3`, "/"), undefined);
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
    it("редирект и пайп не прячут ssh-push", () => {
        const dir = repoWithOrigin("git@github.com:diode-editor/diode.git");
        try {
            assert.ok(checkBash("git push 2>&1 | tail -5", dir));
            assert.ok(checkBash("git push > /tmp/push.log", dir));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
    it("ssh-push в тексте (кавычки, heredoc) — не push", () => {
        const ssh = "git push git@github.com:diode-editor/diode.git b";
        assert.equal(checkBash(`git commit -m "docs: не делай так; ${ssh}"`, "/"), undefined);
        assert.equal(checkBash(`cat > notes.md <<'EOF'\n${ssh}\nEOF`, "/"), undefined);
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
            ["scenario", "settings", "api-coverage"],
        );
        const ok = checklist({
            files: [
                "src/vscode-dts/vscode.d.ts",
                "docs/public/API-COVERAGE.md",
                "e2e/scenarios/x.scenario.ts",
                "src/vs/workbench/common/configuration/editorConfiguration.ts",
            ],
            subjects: ["feat(api)!: x"],
            transcript: ran,
        });
        assert.deepEqual(ok, []);
    });
    it("feat без настроек: напоминание; fix — молчим", () => {
        const scenario = "e2e/scenarios/x.scenario.ts";
        const feat = checklist({ files: ["src/a.ts", scenario], subjects: ["feat(x): y"], transcript: ran });
        assert.deepEqual(
            feat.map((i) => i.id),
            ["settings"],
        );
        assert.deepEqual(checklist({ files: ["src/a.ts"], subjects: ["fix(x): y"], transcript: ran }), []);
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
