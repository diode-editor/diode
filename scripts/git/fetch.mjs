#!/usr/bin/env node
// npm run git:fetch [-- <ветка>…] — обновить origin/main (и названные ветки)
// по https, НЕ удаляя остальные ref'ы.
//
// Грабля, которую это закрывает: на машине fetch.prune=true, и
// `git fetch <url> main:refs/remotes/origin/main` считает все прочие
// refs/remotes/origin/* удалёнными на сервере и сносит их. --no-prune обязателен.
import { assertDiodeCheckout, die, git, gitOk, loud, REPO_URL, short } from "./lib.mjs";

assertDiodeCheckout();

const branches = ["main", ...process.argv.slice(2).filter((b) => b !== "main")];
for (const b of branches) if (b.startsWith("-")) die(`git:fetch принимает только имена веток, а не «${b}»`);

const before = new Map(
    branches.map((b) => [
        b,
        gitOk("rev-parse", "-q", "--verify", `refs/remotes/origin/${b}`)
            ? git("rev-parse", `refs/remotes/origin/${b}`)
            : undefined,
    ]),
);
const refspecs = branches.map((b) => `+refs/heads/${b}:refs/remotes/origin/${b}`);
const code = loud("git", ["fetch", "--no-prune", "--no-tags", REPO_URL, ...refspecs]);
if (code !== 0) process.exit(code);

for (const b of branches) {
    const now = git("rev-parse", `refs/remotes/origin/${b}`);
    const was = before.get(b);
    const what = was === undefined ? "новая" : was === now ? "без изменений" : `${short(was)} → ${short(now)}`;
    console.log(`origin/${b}: ${short(now)} (${what})`);
}
