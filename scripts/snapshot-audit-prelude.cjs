// Ловушки аудита V8-снапшота (scripts/check-snapshot.mjs): дописываются ПЕРЕД
// `dist/main.cjs` в одноразовую копию; каждое чтение окружения верхним уровнем — со
// стеком, перед сериализацией находки уходят в `DIODE_SNAPSHOT_AUDIT_OUT`.
(() => {
    const v8 = require("node:v8");
    if (!v8.startupSnapshot.isBuildingSnapshot()) return;
    const fs = require("node:fs");
    const os = require("node:os");
    const crypto = require("node:crypto");
    const { performance } = require("node:perf_hooks");

    const outPath = process.env.DIODE_SNAPSHOT_AUDIT_OUT;
    const hits = [];
    let armed = true;
    const record = (what) => {
        if (!armed) return;
        armed = false; // стек и запись сами дёргают ловушки
        try {
            const stack = (new Error().stack ?? "").split("\n").slice(2, 14).map((line) => line.trim());
            hits.push({ what, stack });
        } finally {
            armed = true;
        }
    };

    /** @type {Array<() => void>} */
    const restore = [];
    const wrapMethod = (owner, key, label) => {
        const original = owner[key];
        owner[key] = function (...args) {
            record(label);
            return Reflect.apply(original, this, args);
        };
        restore.push(() => {
            owner[key] = original;
        });
    };
    const wrapGetter = (owner, key, label) => {
        const descriptor = Object.getOwnPropertyDescriptor(owner, key);
        if (descriptor === undefined) return;
        const read = descriptor.get ?? (() => descriptor.value);
        Object.defineProperty(owner, key, {
            configurable: true,
            enumerable: descriptor.enumerable,
            get() {
                record(label);
                return read.call(this);
            },
            set(value) {
                record(label);
                if (descriptor.set !== undefined) descriptor.set.call(this, value);
                else Object.defineProperty(owner, key, { ...descriptor, value });
            },
        });
        restore.push(() => Object.defineProperty(owner, key, descriptor));
    };

    const env = process.env;
    process.env = new Proxy(env, {
        get(target, key, receiver) {
            if (typeof key === "string") record(`process.env.${key}`);
            return Reflect.get(target, key, receiver);
        },
        has(target, key) {
            if (typeof key === "string") record(`process.env.${key} (in)`);
            return Reflect.has(target, key);
        },
        ownKeys(target) {
            record("process.env (перечисление)");
            return Reflect.ownKeys(target);
        },
    });
    restore.push(() => {
        process.env = env;
    });
    for (const key of ["argv", "argv0", "execPath", "execArgv", "pid", "ppid", "stdin", "stdout", "stderr"]) {
        wrapGetter(process, key, `process.${key}`);
    }
    for (const key of ["cwd", "chdir", "hrtime", "on", "once", "addListener", "prependListener", "umask", "getuid"]) {
        wrapMethod(process, key, `process.${key}()`);
    }
    wrapMethod(process.hrtime, "bigint", "process.hrtime.bigint()");
    for (const key of ["homedir", "tmpdir", "userInfo", "hostname", "cpus", "availableParallelism", "networkInterfaces", "totalmem", "freemem", "uptime"]) {
        wrapMethod(os, key, `os.${key}()`);
    }
    wrapMethod(Date, "now", "Date.now()");
    wrapMethod(Math, "random", "Math.random()");
    wrapMethod(performance, "now", "performance.now()");
    wrapGetter(performance, "timeOrigin", "performance.timeOrigin");
    for (const key of ["randomUUID", "randomBytes", "randomInt", "getRandomValues"]) wrapMethod(crypto, key, `crypto.${key}()`);
    if (globalThis.crypto !== undefined) {
        for (const key of ["randomUUID", "getRandomValues"]) wrapMethod(globalThis.crypto, key, `crypto.${key}()`);
    }
    // Таймеры при сборке срабатывают у сборщика, а не у пользователя.
    for (const key of ["setTimeout", "setInterval", "setImmediate", "queueMicrotask"]) wrapMethod(globalThis, key, `${key}()`);
    const OriginalDate = Date;
    globalThis.Date = new Proxy(OriginalDate, {
        construct(target, args, newTarget) {
            if (args.length === 0) record("new Date()");
            return Reflect.construct(target, args, newTarget);
        },
        apply(target, thisArg, args) {
            record("Date()");
            return Reflect.apply(target, thisArg, args);
        },
    });
    restore.push(() => {
        globalThis.Date = OriginalDate;
    });

    v8.startupSnapshot.addSerializeCallback(() => {
        armed = false;
        for (const undo of restore.reverse()) undo();
        if (outPath !== undefined) fs.writeFileSync(outPath, JSON.stringify(hits));
    });
})();
