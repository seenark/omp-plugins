import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { HEADROOM_PROXY_TOKEN_FILE, HeadroomHttpClient, loadHeadroomProxyToken, writeHeadroomProxyToken } from "./client.ts";

describe("Headroom HTTP client", () => {
	it("uses proxy health, stats, and compression endpoints with token", async () => {
		let stackHeader = "";
		let requestBody: Record<string, unknown> | undefined;
		const proxyTokens: Array<{ path: string; token: string | null }> = [];
		const server = Bun.serve({
			port: 0,
			async fetch(request) {
				const url = new URL(request.url);
				proxyTokens.push({ path: url.pathname, token: request.headers.get("x-headroom-proxy-token") });
				if (url.pathname === "/health") return Response.json({ status: "healthy" });
				if (url.pathname === "/stats") return Response.json({ compression: { requests: 1 } });
				if (url.pathname === "/v1/compress") {
					stackHeader = request.headers.get("x-headroom-stack") ?? "";
					requestBody = (await request.json()) as Record<string, unknown>;
					return Response.json({
						messages: [{ role: "user", content: "compressed" }],
						tokens_before: 100,
						tokens_after: 60,
						tokens_saved: 40,
						compression_ratio: 0.6,
						transforms_applied: ["structural"],
						ccr_hashes: ["hash"],
					});
				}
				return new Response("not found", { status: 404 });
			},
		});

		try {
			const client = new HeadroomHttpClient({
				baseUrl: `http://127.0.0.1:${server.port}`,
				timeoutMs: 1000,
				proxyToken: "  test-proxy-token  ",
			});
			expect(await client.health()).toBe(true);
			expect(await client.stats()).toEqual({ compression: { requests: 1 } });
			const result = await client.compress([{ role: "user", content: "hello" }], undefined);
			expect(proxyTokens).toEqual([
				{ path: "/health", token: "test-proxy-token" },
				{ path: "/stats", token: "test-proxy-token" },
				{ path: "/v1/compress", token: "test-proxy-token" },
			]);

			expect(stackHeader).toBe("omp-extension");
			expect(requestBody).toEqual({ messages: [{ role: "user", content: "hello" }], model: "gpt-4o" });
			expect(result).toMatchObject({
				tokensBefore: 100,
				tokensAfter: 60,
				tokensSaved: 40,
				compressionRatio: 0.6,
				compressed: true,
			});
		} finally {
			server.stop(true);
		}
	});
	it("omits proxy token header when token is blank", async () => {
		const proxyTokens: Array<string | null> = [];
		const server = Bun.serve({
			port: 0,
			fetch(request) {
				proxyTokens.push(request.headers.get("x-headroom-proxy-token"));
				const pathname = new URL(request.url).pathname;
				if (pathname === "/health") return Response.json({ status: "ok" });
				if (pathname === "/stats") return Response.json({});
				return Response.json({
					messages: [],
					tokens_before: 0,
					tokens_after: 0,
					tokens_saved: 0,
					compression_ratio: 1,
					transforms_applied: [],
				});
			},
		});

		try {
			const client = new HeadroomHttpClient({
				baseUrl: `http://127.0.0.1:${server.port}`,
				timeoutMs: 1000,
				proxyToken: " \t ",
			});
			await client.health();
			await client.stats();
			await client.compress([{ role: "user", content: "hello" }], undefined);
			expect(proxyTokens).toEqual([null, null, null]);
		} finally {
			server.stop(true);
		}
	});

	it("loads optional proxy token file without making read failures fatal", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-token-"));
		const tokenPath = path.join(root, "proxy-token");
		try {
			expect(HEADROOM_PROXY_TOKEN_FILE).toBe(
				path.join(os.homedir(), ".config", "codesook-omp", "headroom", "proxy-token"),
			);
			expect(loadHeadroomProxyToken(tokenPath)).toBeUndefined();

			fs.writeFileSync(tokenPath, " \n\t");
			expect(loadHeadroomProxyToken(tokenPath)).toBeUndefined();

			fs.writeFileSync(tokenPath, "\n  file-token \t\n");
			expect(loadHeadroomProxyToken(tokenPath)).toBe("file-token");

			fs.rmSync(tokenPath);
			fs.mkdirSync(tokenPath);
			expect(loadHeadroomProxyToken(tokenPath)).toBeUndefined();
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("writes a trimmed proxy token with private permissions and validates input", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-token-write-"));
		const tokenPath = path.join(root, "headroom", "proxy-token");
		try {
			expect(writeHeadroomProxyToken("  first-token \n", tokenPath)).toBe(tokenPath);
			expect(fs.readFileSync(tokenPath, "utf8")).toBe("first-token\n");
			expect(fs.statSync(tokenPath).mode & 0o777).toBe(0o600);
			expect(fs.statSync(path.dirname(tokenPath)).mode & 0o777).toBe(0o700);

			fs.chmodSync(tokenPath, 0o644);
			expect(writeHeadroomProxyToken(" second-token ", tokenPath)).toBe(tokenPath);
			expect(loadHeadroomProxyToken(tokenPath)).toBe("second-token");
			expect(fs.statSync(tokenPath).mode & 0o777).toBe(0o600);

			expect(() => writeHeadroomProxyToken(" \n", tokenPath)).toThrow("must not be empty");
			expect(() => writeHeadroomProxyToken("token\nwith-newline", tokenPath)).toThrow("must not contain newlines");
			expect(loadHeadroomProxyToken(tokenPath)).toBe("second-token");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
