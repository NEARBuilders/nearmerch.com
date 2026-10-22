import { readFileSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
	SKILL_CONTENT_TYPE,
	SKILL_PATH,
	setupSkillRoute,
} from "@/services/skill";

const skillSource = readFileSync(
	path.resolve(__dirname, "../../../skills/nearmerch/SKILL.md"),
	"utf8",
);

function createApp() {
	const app = new Hono();
	setupSkillRoute(app);
	app.get("*", (c) => c.html("<!DOCTYPE html><html></html>"));
	return app;
}

describe("GET /skill.md", () => {
	it("serves the repo skill file as markdown, ahead of the SSR catch-all", async () => {
		const res = await createApp().request(SKILL_PATH);

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe(SKILL_CONTENT_TYPE);
		expect(await res.text()).toBe(skillSource);
	});

	it("starts with Agent Skills frontmatter", async () => {
		const body = await (await createApp().request(SKILL_PATH)).text();

		expect(body.startsWith("---\nname: nearmerch\n")).toBe(true);
		expect(body).toMatch(/\ndescription: .+\n/);
	});

	it("answers HEAD without a body", async () => {
		const res = await createApp().request(SKILL_PATH, { method: "HEAD" });

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe(SKILL_CONTENT_TYPE);
		expect(await res.text()).toBe("");
	});

	it("leaves other routes to the catch-all", async () => {
		const res = await createApp().request("/");

		expect(res.headers.get("content-type")).toContain("text/html");
	});
});
