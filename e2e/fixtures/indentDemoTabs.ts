export function farewell(name: string): string {
	if (name.length === 0) {
		return "bye, stranger";
	}
	return `bye, ${name}`;
}
