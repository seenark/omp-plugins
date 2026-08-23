import { describe, expect, it } from "bun:test";
import { applyCompressionResult, buildCompressionPayload } from "./bridge.ts";
import type { AgentMessage, OpenAIMessage } from "./types.ts";

function createAssistantMessage(): AgentMessage {
	return {
		role: "assistant",
		content: [
			{
				type: "toolCall",
				id: "call_1",
				name: "list_records",
				arguments: { limit: 1000 },
			},
		],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-test",
		usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "toolUse",
		timestamp: 1,
	} as AgentMessage;
}

function createToolResult(text: string): AgentMessage {
	return {
		role: "toolResult",
		toolCallId: "call_1",
		toolName: "list_records",
		content: [{ type: "text", text }],
		details: { rows: 1000 },
		isError: false,
		timestamp: 2,
	} as AgentMessage;
}

function createUserMessage(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp: 0 } as AgentMessage;
}

describe("Headroom compression bridge", () => {
	it("changes only candidate toolResult text and preserves metadata", () => {
		const messages = [
			createUserMessage("summarize records"),
			createAssistantMessage(),
			createToolResult(JSON.stringify(Array.from({ length: 10 }, (_, id) => ({ id, status: "ok" })))),
		];
		const payload = buildCompressionPayload(messages, 10);
		const compressed = payload.messages.map((message): OpenAIMessage =>
			message.role === "tool" ? { ...message, content: "compressed result" } : message,
		);

		const result = applyCompressionResult(messages, payload.mappings, compressed, { minMessageChars: 10 });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const toolResult = result.messages[2] as Extract<AgentMessage, { role: "toolResult" }>;
		expect(toolResult.toolName).toBe("list_records");
		expect(toolResult.details).toEqual({ rows: 1000 });
		expect(toolResult.content).toEqual([{ type: "text", text: "compressed result" }]);
	});

	it("preserves non-cloneable metadata while changing tool result text", () => {
		const toolResult = {
			...createToolResult("large result"),
			details: { rows: 1000, transform() {} },
		} as AgentMessage;
		const messages = [toolResult];
		const payload = buildCompressionPayload(messages, 1);
		const compressed = payload.messages.map((message): OpenAIMessage =>
			message.role === "tool" ? { ...message, content: "compressed result" } : message,
		);

		const result = applyCompressionResult(messages, payload.mappings, compressed, { minMessageChars: 1 });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.messages).not.toBe(messages);
		expect((result.messages[0] as AgentMessage & { details: { transform: () => void } }).details.transform).toBe(
			(toolResult as AgentMessage & { details: { transform: () => void } }).details.transform,
		);
		expect((result.messages[0] as Extract<AgentMessage, { role: "toolResult" }>).content).toEqual([
			{ type: "text", text: "compressed result" },
		]);
		expect((messages[0] as Extract<AgentMessage, { role: "toolResult" }>).content).toEqual([
			{ type: "text", text: "large result" },
		]);
	});

	it("rejects a changed message count", () => {
		const messages = [createUserMessage("go"), createAssistantMessage(), createToolResult("large result")];
		const payload = buildCompressionPayload(messages, 5);

		expect(applyCompressionResult(messages, payload.mappings, payload.messages.slice(1), { minMessageChars: 5 })).toEqual({
			ok: false,
			reason: "message-count-changed",
		});
	});

	it("omits image bytes from the compression payload", () => {
		const messages = [
			{
				role: "user",
				content: [
					{ type: "text", text: "inspect this" },
					{ type: "image", data: "base64-image-data", mimeType: "image/png" },
				],
				timestamp: 0,
			} as AgentMessage,
			createAssistantMessage(),
			createToolResult("large result"),
		];

		const payload = buildCompressionPayload(messages, 5);

		expect(payload.messages[0]).toEqual({ role: "user", content: "inspect this" });
		expect(JSON.stringify(payload.messages)).not.toContain("base64-image-data");
	});
});
