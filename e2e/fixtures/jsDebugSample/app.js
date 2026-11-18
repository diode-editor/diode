const { fork } = require("node:child_process");

function add(a, b) {
    const sum = a + b;
    return sum;
}

const total = add(2, 3);
console.log("total", total);
if (process.argv[2] === "fork") {
    const child = fork(`${__dirname}/child.js`);
    child.on("exit", () => console.log("child done"));
}
