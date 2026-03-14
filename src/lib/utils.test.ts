import { expect, test } from "bun:test";
import { cn } from "./utils";

test("cn merges class names", () => {
	expect(cn("foo", "bar")).toBe("foo bar");
});

test("cn handles conditional classes", () => {
	expect(cn("foo", false && "bar", "baz")).toBe("foo baz");
});

test("cn merges tailwind conflicts correctly", () => {
	expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
});
