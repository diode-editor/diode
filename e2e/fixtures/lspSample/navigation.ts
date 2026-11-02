export interface Solo {
    only(): void;
}

export class TheOne implements Solo {
    only(): void {}
}

function render() {}

export function paint() {
    render();
}

export function update() {
    render();
}
