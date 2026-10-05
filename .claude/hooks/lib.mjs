// Общее для проектных хуков Claude Code (.claude/settings.json → hooks).
//
// Протокол: JSON события приходит в stdin; `exit 2` + текст в stderr — отказ
// (PreToolUse: инструмент не вызывается, текст уходит модели); `exit 0` — пропуск.
// Хук — страховка, а не стена: любая собственная поломка (битый JSON, нет git,
// чужой репозиторий) трактуется как «пропустить», поэтому всё тело завёрнуто
// в `runHook`, а он на исключении выходит нулём.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function readStdin() {
    try {
        return JSON.parse(readFileSync(0, "utf8"));
    } catch {
        return undefined;
    }
}

/**
 * Запуск тела хука. `body(input)` возвращает:
 *   - undefined — пропустить;
 *   - { block: string } — отказ (exit 2, текст в stderr);
 *   - { json: object } — ответ JSON'ом в stdout (exit 0).
 */
export function runHook(body) {
    try {
        const input = readStdin();
        if (input === undefined) return;
        const res = body(input);
        if (res?.block) {
            process.stderr.write(res.block.trimEnd() + "\n");
            process.exitCode = 2;
        } else if (res?.json) {
            process.stdout.write(JSON.stringify(res.json));
        }
    } catch {
        process.exitCode = 0;
    }
}

export function git(cwd, args) {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 });
}

/**
 * Простые команды из командной строки Bash: режем по `&&`, `||`, `;`, `|` и
 * переводу строки, каждую — на слова (кавычки снимаются, подстановки не
 * раскрываются). Для распознавания `git push …` и `npm run …` этого хватает:
 * ложное «не распознал» безопасно — хук просто пропустит.
 */
export function simpleCommands(cmdline) {
    const out = [];
    for (const part of cmdline.split(/&&|\|\||[;|\n]/)) {
        const words = [];
        const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
        let m;
        while ((m = re.exec(part)) !== null) words.push(m[1] ?? m[2] ?? m[3]);
        // Префиксы окружения (FOO=1 git push) и обёртки не мешают распознаванию.
        while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
        if (words.length > 0) out.push(words);
    }
    return out;
}

/** Слова `git <sub> …` без глобальных опций git (`-C dir`, `-c k=v`). */
export function gitSubcommand(words) {
    if (words[0] !== "git") return undefined;
    let i = 1;
    while (i < words.length && words[i].startsWith("-")) {
        i += words[i] === "-C" || words[i] === "-c" ? 2 : 1;
    }
    if (i >= words.length) return undefined;
    const cwdIdx = words.indexOf("-C");
    return {
        sub: words[i],
        args: words.slice(i + 1),
        dir: cwdIdx > 0 && cwdIdx < i ? words[cwdIdx + 1] : undefined,
    };
}
