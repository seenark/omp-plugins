import { describe, expect, it } from "bun:test";
import { applyCompressionResult, buildCompressionPayload, replaceToolResultTexts } from "./bridge.ts";
import type { AgentMessage, OpenAIMessage } from "./types.ts";

function createAssistantMessage(call: { id?: string; name?: string; arguments?: Record<string, unknown> } = {}): AgentMessage {
	return {
		role: "assistant",
		content: [
			{
				type: "toolCall",
				id: call.id ?? "call_1",
				name: call.name ?? "list_records",
				arguments: call.arguments ?? { limit: 1000 },
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

function createToolResult(text: string, extra: { id?: string; isError?: boolean } = {}): AgentMessage {
	return {
		role: "toolResult",
		toolCallId: extra.id ?? "call_1",
		toolName: "list_records",
		content: [{ type: "text", text }],
		details: { rows: 1000 },
		isError: extra.isError ?? false,
		timestamp: 2,
	} as AgentMessage;
}

function createUserMessage(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp: 0 } as AgentMessage;
}

function shrinkTools(messages: OpenAIMessage[]): OpenAIMessage[] {
	return messages.map((message): OpenAIMessage => (message.role === "tool" ? { ...message, content: "small" } : message));
}

function toolText(message: AgentMessage): string {
	return ((message as Extract<AgentMessage, { role: "toolResult" }>).content as Array<{ text: string }>)[0]?.text ?? "";
}

describe("Headroom compression bridge", () => {
	it("changes only candidate toolResult text and preserves metadata", () => {
		const messages = [
			createUserMessage("summarize records"),
			createAssistantMessage(),
			createToolResult(JSON.stringify(Array.from({ length: 10 }, (_, id) => ({ id, status: "ok" })))),
		];
		const payload = buildCompressionPayload(messages, 10);
		const applied = applyCompressionResult(payload.mappings, shrinkTools(payload.messages));

		expect(applied.ok).toBe(true);
		if (!applied.ok) return;
		const result = replaceToolResultTexts(messages, applied.replacements);
		const toolResult = result.messages[2] as Extract<AgentMessage, { role: "toolResult" }>;
		expect(toolResult.toolCallId).toBe("call_1");
		expect(toolResult.toolName).toBe("list_records");
		expect(toolResult.isError).toBe(false);
		expect(toolResult.details).toEqual({ rows: 1000 });
		expect(toolResult.content).toEqual([{ type: "text", text: "small" }]);
		expect(result.messages[0]).toBe(messages[0]);
		expect(result.messages[1]).toBe(messages[1]);
		expect(toolText(messages[2])).not.toBe("small");
	});

	it("sends real tool names and JSON arguments without touching the original", () => {
		const messages = [createAssistantMessage({ name: "bash", arguments: { command: "cat a.ts" } }), createToolResult("large result")];
		const payload = buildCompressionPayload(messages, 1);
		const assistant = payload.messages[0];

		expect(assistant.role).toBe("assistant");
		if (assistant.role !== "assistant" || !assistant.tool_calls) return;
		expect(assistant.tool_calls[0]?.function.name).toBe("bash");
		expect(assistant.tool_calls[0]?.function.arguments).toBe(JSON.stringify({ command: "cat a.ts" }));
		expect((messages[0] as AgentMessage & { content: Array<{ name: string }> }).content[0]?.name).toBe("bash");
	});

	it("never offers failed or RTK-processed tool results", () => {
		const rtkCommands = ["rtk git status", "cd app && rtk cargo test", "echo hi; rtk ls", "cat x | rtk grep y"];
		const messages = [
			createAssistantMessage({ id: "ok", name: "bash", arguments: { command: "cat big.log" } }),
			createToolResult("plain large result", { id: "ok" }),
			createAssistantMessage({ id: "failed", name: "bash", arguments: { command: "make test" } }),
			createToolResult("failure output", { id: "failed", isError: true }),
			...rtkCommands.flatMap((command, index) => [
				createAssistantMessage({ id: `rtk${index}`, name: "bash", arguments: { command } }),
				createToolResult("rtk compacted output", { id: `rtk${index}` }),
			]),
		];
		const payload = buildCompressionPayload(messages, 1);

		expect(payload.mappings.filter(({ applyTo }) => applyTo).map(({ toolCallId }) => toolCallId)).toEqual(["ok"]);
		const applied = applyCompressionResult(payload.mappings, shrinkTools(payload.messages));
		expect(applied.ok && [...applied.replacements.keys()]).toEqual(["ok"]);
	});

	it("applies each changed candidate and ignores server changes to everything else", () => {
		const messages = [
			createUserMessage("go"),
			createAssistantMessage({ id: "a" }),
			createToolResult("first large result", { id: "a" }),
			createAssistantMessage({ id: "b" }),
			createToolResult("tiny", { id: "b" }),
			createAssistantMessage({ id: "c" }),
			createToolResult("third large result", { id: "c" }),
		];
		const payload = buildCompressionPayload(messages, 10);
		const server = payload.messages.map((message): OpenAIMessage => {
			if (message.role === "user") return { ...message, content: "rewritten user" };
			if (message.role === "assistant") return { ...message, content: "rewritten assistant" };
			if (message.role === "tool" && message.tool_call_id === "a") return { ...message, content: "A" };
			if (message.role === "tool" && message.tool_call_id === "b") return { ...message, content: "B" };
			if (message.role === "tool" && message.tool_call_id === "c") return { ...message, content: "x".repeat(100) };
			return message;
		});

		const applied = applyCompressionResult(payload.mappings, server);

		expect(applied.ok).toBe(true);
		if (!applied.ok) return;
		expect([...applied.replacements]).toEqual([["a", "A"]]);
		expect(applied.rejected).toEqual(["not-smaller"]);
	});

	it("drops only the misaligned candidate", () => {
		const messages = [
			createAssistantMessage({ id: "a" }),
			createToolResult("first large result", { id: "a" }),
			createAssistantMessage({ id: "b" }),
			createToolResult("second large result", { id: "b" }),
		];
		const payload = buildCompressionPayload(messages, 5);
		const server = payload.messages.map((message): OpenAIMessage => {
			if (message.role === "tool" && message.tool_call_id === "a") return { role: "tool", tool_call_id: "zzz", content: "A" };
			if (message.role === "tool") return { ...message, content: "B" };
			return message;
		});

		const applied = applyCompressionResult(payload.mappings, server);

		expect(applied.ok && [...applied.replacements]).toEqual([["b", "B"]]);
		expect(applied.ok && applied.rejected).toEqual(["tool-call-id-changed"]);
	});

	it("preserves non-cloneable metadata while changing tool result text", () => {
		const toolResult = {
			...createToolResult("large result"),
			details: { rows: 1000, transform() {} },
		} as AgentMessage;
		const messages = [toolResult];

		const result = replaceToolResultTexts(messages, new Map([["call_1", "small"]]));

		expect(result.messages).not.toBe(messages);
		expect((result.messages[0] as AgentMessage & { details: { transform: () => void } }).details.transform).toBe(
			(toolResult as AgentMessage & { details: { transform: () => void } }).details.transform,
		);
		expect(toolText(result.messages[0])).toBe("small");
		expect(toolText(messages[0])).toBe("large result");
		expect(result).toMatchObject({ originalChars: 12, forwardedChars: 5, replaced: 1 });
	});

	it("returns the same array when no replacement applies", () => {
		const messages = [createToolResult("large result")];
		expect(replaceToolResultTexts(messages, new Map()).messages).toBe(messages);
		expect(replaceToolResultTexts(messages, new Map([["other", "x"]])).messages).toBe(messages);
	});

	it("rejects a changed message count", () => {
		const messages = [createUserMessage("go"), createAssistantMessage(), createToolResult("large result")];
		const payload = buildCompressionPayload(messages, 5);

		expect(applyCompressionResult(payload.mappings, payload.messages.slice(1))).toEqual({
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
