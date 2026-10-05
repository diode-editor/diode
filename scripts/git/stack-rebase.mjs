#!/usr/bin/env node
// npm run git:stack-rebase -- <ветка> --base <старая-база> [--dry-run]
//
// Стек PR после squash-merge базы: ветка-ребёнок стоит на коммитах родителя,
// а в main родитель приехал ОДНИМ squash-коммитом с другим SHA. Обычный
// `git rebase origin/main` переигрывает коммиты родителя заново и тонет в
// конфликтах с самим собой — нужен `--onto`, отрезающий всё до старой базы:
//
//   git rebase --onto origin/main <старая-база> <ветка>
//
// <старая-база> — коммит, на котором ветка стояла (голова родителя): ref/SHA
// или номер влитого PR (`#123` / `123`) — тогда берётся его headRefOid.
//
// Перед rebase: тег-страховка `backup/<ветка>/<время>` (backup-ветку rebase
// уносит через update-ref, тег — нет) и SHA ветки на сервере для
// --force-with-lease в git:push.
import { assertDiodeCheckout, cap, die, git, gitOk, isAncestor, loud, remoteSha, saveLease, short } from "./lib.mjs";

assertDiodeCheckout();

function usage(code) {
    console.log(`Использование: npm run git:stack-rebase -- <ветка> --base <старая-база | #PR> [--onto <ref>] [--dry-run]

  <ветка>        ветка-ребёнок, которую переносим
  --base         где ветка стояла: голова родителя (ref/SHA) или номер влитого PR
  --onto         куда переносим (по умолчанию origin/main; сначала npm run git:fetch)
  --dry-run      только показать план`);
    process.exit(code);
}

const argv = process.argv.slice(2);
let branch;
let baseArg;
let onto = "origin/main";
let dryRun = false;
for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") usage(0);
    else if (a === "--base") baseArg = argv[++i];
    else if (a.startsWith("--base=")) baseArg = a.slice(7);
    else if (a === "--onto") onto = argv[++i];
    else if (a.startsWith("--onto=")) onto = a.slice(7);
    else if (a === "--dry-run") dryRun = true;
    else if (!a.startsWith("-") && branch === undefined) branch = a;
    else die(`git:stack-rebase: неизвестный аргумент «${a}»`, 2);
}
if (branch === undefined || baseArg === undefined || onto === undefined) usage(2);
if (!gitOk("rev-parse", "-q", "--verify", `refs/heads/${branch}`)) die(`Нет локальной ветки ${branch}.`);

// --- Старая база ---
let oldBase;
let squash;
const pr = /^#?(\d+)$/.exec(baseArg);
if (pr) {
    const info = JSON.parse(cap("gh", ["pr", "view", pr[1], "--json", "state,headRefOid,mergeCommit,headRefName"]).out);
    if (info.state !== "MERGED") die(`PR #${pr[1]} в состоянии ${info.state}, а не MERGED — переносить не на что.`);
    oldBase = info.headRefOid;
    squash = info.mergeCommit?.oid;
    if (!gitOk("cat-file", "-e", `${oldBase}^{commit}`)) {
        die(`Головы PR #${pr[1]} (${short(oldBase)}) нет локально. Ветка ${branch} точно на ней стоит?
Если ветка родителя ${info.headRefName} у тебя есть — передай её как --base.`);
    }
} else {
    if (!gitOk("rev-parse", "-q", "--verify", `${baseArg}^{commit}`)) die(`--base: не знаю коммит «${baseArg}».`);
    oldBase = git("rev-parse", `${baseArg}^{commit}`);
}
const ontoSha = git("rev-parse", `${onto}^{commit}`);
const head = git("rev-parse", branch);

// --- Распознавание ситуации: отказ, если это не «база влита squash'ем» ---
if (!isAncestor(oldBase, head)) {
    die(`${short(oldBase)} не предок ${branch} — ветка стоит не на этой базе. Проверь --base.`);
}
if (isAncestor(oldBase, ontoSha)) {
    die(`${short(oldBase)} уже предок ${onto}: база влита merge-коммитом или fast-forward, а не squash.
Тут --onto не нужен — хватит обычного: git rebase ${onto} ${branch}`);
}
if (squash !== undefined && !isAncestor(squash, ontoSha)) {
    die(`Squash-коммит PR (${short(squash)}) ещё не в ${onto}. Обнови: npm run git:fetch — и повтори.`);
}
if (squash === undefined) {
    // База задана ref'ом, gh не спрашивали. Squash — это один коммит с
    // суммарным диффом родителя: ищем в onto коммит с тем же patch-id.
    // Не нашли — отказ: значит, при мерже дифф правили, и тогда честнее
    // назвать PR (--base #N), чем угадывать.
    const fork = git("merge-base", oldBase, ontoSha);
    const patchId = (input) => cap("git", ["patch-id", "--stable"], { input }).out;
    const parentId = patchId(cap("git", ["diff", fork, oldBase]).out).split(/\s+/)[0];
    const ids = patchId(cap("git", ["log", "-p", "--no-merges", "--format=commit %H", `${fork}..${ontoSha}`]).out);
    const hit = ids
        .split("\n")
        .map((l) => l.split(/\s+/))
        .find(([id]) => id === parentId);
    if (hit === undefined) {
        die(`Не нашёл в ${onto} squash-коммита с диффом родителя (${short(fork)}..${short(oldBase)}).
Либо родитель ещё не влит (npm run git:fetch?), либо дифф правили при мерже —
тогда назови влитый PR: --base #<номер>.`);
    }
    console.log(`Squash родителя в ${onto}: ${git("log", "-1", "--format=%h %s", hit[1])}`);
}

// --- План ---
const moving = git("log", "--format=  %h %s", `${oldBase}..${head}`);
const count = moving.split("\n").filter(Boolean).length;
console.log(`План:
  git rebase --onto ${onto} ${short(oldBase)} ${branch}
Переносятся ${count} коммит(ов) ${branch} поверх ${onto} (${short(ontoSha)}):
${moving}
Коммиты родителя до ${short(oldBase)} отрезаются — они уже в ${onto} squash'ем.`);
if (dryRun) process.exit(0);

// --- Страховка и SHA для --force-with-lease ---
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
const tag = `backup/${branch}/${stamp}`;
git("tag", tag, head);
console.log(`Страховка: тег ${tag} → ${short(head)} (вернуть: git reset --hard ${tag})`);
let serverSha;
try {
    serverSha = remoteSha(branch);
    saveLease(branch, serverSha);
    console.log(`На сервере ${branch}: ${serverSha ? short(serverSha) : "ветки нет"} — запомнил для npm run git:push.`);
} catch (e) {
    console.log(`⚠ Не смог спросить сервер (${e.message.split("\n")[0]}); git:push спросит SHA сам.`);
}

const code = loud("git", ["rebase", "--onto", ontoSha, oldBase, branch]);
if (code !== 0) {
    console.log(`\nRebase остановился. Разреши конфликты и \`git rebase --continue\`, или откатись: git rebase --abort.
Страховка: ${tag}. Потом: npm run git:push -- ${branch}`);
    process.exit(code);
}
console.log(`\nГотово. Проверь (npm run check:diff), затем: npm run git:push -- ${branch}`);
