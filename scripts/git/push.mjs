#!/usr/bin/env node
// npm run git:push [-- <ветка>] [--expect <sha>] — push ветки по https.
//
// Только https (origin — ssh, а ssh живёт лишь с проброшенным агентом). Перезапись —
// только `--force-with-lease=refs/heads/<b>:<sha>` с ЯВНЫМ SHA: при push по URL без
// него lease сравнивать не с чем, и он молча становится --force.
//
// SHA для lease (по порядку): --expect; запись git:stack-rebase (снят ДО переписывания);
// сервер — только если локальная его продолжает или ветки нет. Расхождение без
// записи — отказ: это чужой push или ручной rebase.
import {
    assertDiodeCheckout,
    currentBranch,
    die,
    dropLease,
    git,
    gitOk,
    isAncestor,
    loadLease,
    loud,
    remoteSha,
    REPO_URL,
    short,
} from "./lib.mjs";

assertDiodeCheckout();

const argv = process.argv.slice(2);
let branch;
let expect;
for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--expect") expect = argv[++i];
    else if (a.startsWith("--expect=")) expect = a.slice(9);
    else if (a === "--help" || a === "-h") {
        console.log("Использование: npm run git:push -- [<ветка>] [--expect <sha-на-сервере>]");
        process.exit(0);
    } else if (!a.startsWith("-") && branch === undefined) branch = a;
    else die(`git:push: неизвестный аргумент «${a}»`, 2);
}
branch ??= currentBranch();
if (branch === "main") die("В main напрямую не пушим — только через PR.");
if (!gitOk("rev-parse", "-q", "--verify", `refs/heads/${branch}`)) die(`Нет локальной ветки ${branch}.`);

const local = git("rev-parse", `refs/heads/${branch}`);
const server = remoteSha(branch) ?? "";
const recorded = loadLease(branch);

let lease;
if (expect !== undefined) {
    lease = expect === "" ? "" : git("rev-parse", expect);
    if (lease !== server) {
        die(
            `На сервере ${branch} = ${short(server) || "(нет)"}, а ты ждёшь ${short(lease) || "(нет)"} — не перезаписываю.`,
        );
    }
} else if (recorded !== undefined) {
    lease = recorded;
    if (recorded !== server) {
        die(`До rebase на сервере было ${short(recorded) || "(нет ветки)"}, сейчас ${short(server) || "(нет ветки)"}:
кто-то пушил в ${branch} после. Посмотри (npm run git:fetch -- ${branch} && git log ${branch}..origin/${branch}) и, если перезаписать осознанно,
передай --expect ${server}.`);
    }
} else if (server === "" || server === local || isAncestor(server, local)) {
    lease = server;
} else {
    die(`${branch}: локальная ветка не продолжает серверную (${short(server)}), а записи git:stack-rebase нет.
Если историю переписал ты и перезаписать сервер надо — повтори с --expect ${server}.`);
}

if (server === local) {
    console.log(`${branch} на сервере уже ${short(local)} — пушить нечего.`);
    process.exit(0);
}
const code = loud("git", [
    "push",
    `--force-with-lease=refs/heads/${branch}:${lease}`,
    REPO_URL,
    `refs/heads/${branch}:refs/heads/${branch}`,
]);
if (code !== 0) process.exit(code);

dropLease(branch);
// Push по URL не двигает remote-tracking ref.
git("update-ref", `refs/remotes/origin/${branch}`, local);
console.log(`${branch}: ${short(server) || "(новая)"} → ${short(local)}. Статус PR: npm run git:pr-status`);
