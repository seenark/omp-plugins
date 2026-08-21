import { describe, expect, it } from "bun:test";
import { HeadroomHttpClient } from "./client.ts";

describe("Headroom HTTP client", () => {
	it("uses the proxy health, stats, and compression endpoints", async () => {
		let stackHeader = "";
		let requestBody: Record<string, unknown> | undefined;
		const server = Bun.serve({
			port: 0,
			async fetch(request) {
				const url = new URL(request.url);
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
			const client = new HeadroomHttpClient({ baseUrl: `http://127.0.0.1:${server.port}`, timeoutMs: 1000 });
			expect(await client.health()).toBe(true);
			expect(await client.stats()).toEqual({ compression: { requests: 1 } });
			const result = await client.compress([{ role: "user", content: "hello" }], undefined);

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
});
