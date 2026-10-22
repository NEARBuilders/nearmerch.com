import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import { logger } from "../utils/logger";

export const SKILL_PATH = "/skill.md";
export const SKILL_CONTENT_TYPE = "text/markdown; charset=utf-8";

// Single source of truth: skills/nearmerch/SKILL.md at the repo root.
// Bundled host (Zephyr/Railway): rsbuild embeds it via `?raw` (see rsbuild.config.ts).
// Unbundled host (`tsx server.ts` in `bos dev`): `?raw` can't load, so read the file.
async function loadSkillMarkdown(): Promise<string> {
	try {
		const bundled = await import("../../../skills/nearmerch/SKILL.md?raw");
		return bundled.default;
	} catch {
		const here = path.dirname(fileURLToPath(import.meta.url));
		return readFile(
			path.resolve(here, "../../../skills/nearmerch/SKILL.md"),
			"utf8",
		);
	}
}

let skillMarkdown: Promise<string> | null = null;

export function setupSkillRoute(app: Hono) {
	app.get(SKILL_PATH, async (c) => {
		skillMarkdown ??= loadSkillMarkdown();
		try {
			return c.body(await skillMarkdown, 200, {
				"Content-Type": SKILL_CONTENT_TYPE,
				"Cache-Control": "public, max-age=300",
			});
		} catch (error) {
			skillMarkdown = null;
			logger.error("[skill] Failed to load skills/nearmerch/SKILL.md:", error);
			return c.text("Not Found", 404);
		}
	});
}
