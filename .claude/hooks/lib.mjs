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

const HEREDOC = /<<(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|\\?([^\s;&|<>()'"\\]+))/y;
const REDIRECT = /&>>?|<<<|<>|>>|[<>]&|>\||[<>]/y;

/** `<<EOF`, `<<-EOF`, `<<'EOF'` на позиции `i` (here-string `<<<` — не он). */
function heredocAt(s, i) {
    HEREDOC.lastIndex = i;
    const m = HEREDOC.exec(s);
    return m === null ? undefined : { delim: m[2] ?? m[3] ?? m[4], tabs: m[1] === "-", end: HEREDOC.lastIndex };
}

/** Пропускает тела heredoc'ов, начинающиеся с позиции `i` (сразу за переводом строки). */
function skipHeredocs(s, i, heredocs) {
    for (const h of heredocs) {
        while (i < s.length) {
            const eol = s.indexOf("\n", i);
            const line = s.slice(i, eol < 0 ? s.length : eol);
            i = eol < 0 ? s.length : eol + 1;
            if ((h.tabs ? line.replace(/^\t+/, "") : line) === h.delim) break;
        }
    }
    return i;
}

/** Содержимое `"…"` с позиции за открывающей кавычкой; подстановки внутри — сырым текстом. */
function dquote(s, i) {
    let text = "";
    while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\" && i + 1 < s.length) {
            // В двойных кавычках `\` экранирует только эти символы; `\<перевод строки>` — склейка.
            if (!'"$`\\\n'.includes(s[i + 1])) text += "\\";
            if (s[i + 1] !== "\n") text += s[i + 1];
            i += 2;
        } else if (s[i] === "`" || (s[i] === "$" && s[i + 1] === "(")) {
            const end = s[i] === "`" ? backtickEnd(s, i + 1) : substEnd(s, i + 2);
            text += s.slice(i, end);
            i = end;
        } else {
            text += s[i++];
        }
    }
    return { text, end: i + 1 };
}

/** Позиция закрывающей `'` (или конец строки, если кавычка не закрыта). */
function squoteClose(s, i) {
    const close = s.indexOf("'", i);
    return close < 0 ? s.length : close;
}

function backtickEnd(s, i) {
    while (i < s.length && s[i] !== "`") i += s[i] === "\\" ? 2 : 1;
    return i + 1;
}

/** Конец `$( … )` — позиция за парной скобкой; внутри свои кавычки, скобки и heredoc'и. */
function substEnd(s, i) {
    let depth = 1;
    const heredocs = [];
    while (i < s.length) {
        const c = s[i];
        if (c === "\\") i += 2;
        else if (c === "'") i = squoteClose(s, i + 1) + 1;
        else if (c === '"') i = dquote(s, i + 1).end;
        else if (c === "`") i = backtickEnd(s, i + 1);
        else if (c === "\n") i = skipHeredocs(s, i + 1, heredocs.splice(0));
        else if (c === "<" && s[i + 1] === "<") {
            const h = heredocAt(s, i);
            if (h !== undefined) heredocs.push(h);
            i = h?.end ?? i + 2;
        } else {
            if (c === "(") depth++;
            i++;
            if (c === ")" && --depth === 0) return i;
        }
    }
    return i;
}

/**
 * Простые команды из командной строки Bash: режем по `&&`, `||`, `;`, `|`, `&`,
 * скобкам и переводу строки, каждую — на слова. Разбор учитывает то, на чём
 * наивная резка по регулярке давала ложные отказы и пропуски:
 *   - кавычки снимаются, а операторы внутри них команду не режут;
 *   - редиректы (`2>&1`, `> файл`, `&>лог`, `<<< строка`) — не слова команды;
 *   - `$(…)` и `` `…` `` — одно непрозрачное слово (не раскрываются и не проверяются);
 *   - тело heredoc и комментарий `# …` — данные, а не команды.
 * Это не парсер bash: для распознавания `git push …` и `npm run …` хватает, а
 * ложное «не распознал» безопасно — хук просто пропустит.
 */
export function simpleCommands(cmdline) {
    const s = cmdline;
    const out = [];
    let words = [];
    let word; // undefined — слова нет; "" — пустое слово из кавычек
    let dropNext = false; // следующее слово — цель редиректа
    const heredocs = [];
    const endWord = () => {
        if (word === undefined) return;
        if (!dropNext) words.push(word);
        dropNext = false;
        word = undefined;
    };
    const endCommand = () => {
        endWord();
        dropNext = false;
        // Префиксы окружения (FOO=1 git push) и обёртки не мешают распознаванию.
        while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
        if (words.length > 0) out.push(words);
        words = [];
    };
    let i = 0;
    while (i < s.length) {
        const c = s[i];
        if (c === "\n") {
            endCommand();
            i = skipHeredocs(s, i + 1, heredocs.splice(0));
        } else if (/\s/.test(c)) {
            endWord();
            i++;
        } else if (c === "\\") {
            if (s[i + 1] !== "\n") word = (word ?? "") + (s[i + 1] ?? "");
            i += 2;
        } else if (c === "'") {
            const close = squoteClose(s, i + 1);
            word = (word ?? "") + s.slice(i + 1, close);
            i = close + 1;
        } else if (c === '"') {
            const q = dquote(s, i + 1);
            word = (word ?? "") + q.text;
            i = q.end;
        } else if (c === "`" || (c === "$" && s[i + 1] === "(")) {
            const end = c === "`" ? backtickEnd(s, i + 1) : substEnd(s, i + 2);
            word = (word ?? "") + s.slice(i, end);
            i = end;
        } else if (c === "#" && word === undefined) {
            const eol = s.indexOf("\n", i);
            i = eol < 0 ? s.length : eol;
        } else if (c === "<" || c === ">" || (c === "&" && s[i + 1] === ">")) {
            // Номер дескриптора вплотную к редиректу (`2>`) — его часть, а не слово.
            if (word !== undefined && /^\d+$/.test(word)) word = undefined;
            endWord();
            const h = c === "<" ? heredocAt(s, i) : undefined;
            if (h !== undefined) {
                heredocs.push(h);
                i = h.end;
            } else {
                REDIRECT.lastIndex = i;
                i += REDIRECT.exec(s)[0].length;
                dropNext = true;
            }
        } else if (";&|()".includes(c)) {
            endCommand();
            i++;
        } else {
            word = (word ?? "") + c;
            i++;
        }
    }
    endCommand();
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
