// Your own LLM as a recommendation source. Any server that speaks the
// OpenAI chat API works (llama.cpp, vLLM, Ollama, LM Studio, OpenRouter...).
// It gets the same prompt as Gemini and answers "Title, Year" lines.
const fetch = require("node-fetch");
const { getGeminiPrompt, getGeminiSystemInstructions } = require("../config");
const { withTimeout } = require("../utils/timeout");
const logger = require("../utils/logger");

const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 60000;

function cleanBase(baseUrl) {
	return String(baseUrl || "")
		.trim()
		.replace(/\/+$/, "")
		.replace(/\/chat\/completions$/, "");
}

function headers(apiKey) {
	const h = { "Content-Type": "application/json" };
	if (apiKey) h.Authorization = `Bearer ${apiKey}`;
	return h;
}

// Strips reasoning blocks, numbering, bullets and quotes, then reads "Title, Year".
function parseLlmReturn(text) {
	const body = String(text || "")
		.replace(/<think>[\s\S]*?<\/think>/gi, "")
		.replace(/```[a-z]*\n?|```/gi, "");

	return body
		.split("\n")
		.map((row) => row.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim())
		.filter((row) => row !== "")
		.map((row) => {
			const match = row.match(/^(.*?)[,(]\s*((?:19|20)\d{2})\)?\s*$/);
			const title = (match ? match[1] : row.split(",")[0])
				.trim()
				.replace(/^["'*]+|["'*]+$/g, "")
				.trim();
			return { title, year: match ? match[2] : "" };
		})
		.filter((r) => r.title !== "");
}

async function chat(baseUrl, apiKey, model, messages, maxTokens) {
	const response = await withTimeout(
		fetch(`${cleanBase(baseUrl)}/chat/completions`, {
			method: "POST",
			headers: headers(apiKey),
			body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: maxTokens }),
		}),
		LLM_TIMEOUT_MS,
		"LLM request timed out",
	);
	if (!response.ok) return null;
	const json = await response.json();
	return json?.choices?.[0]?.message?.content || null;
}

async function validateAPIKey(apiKey, baseUrl, model) {
	if (!baseUrl) return false;
	try {
		// A model list is the cheapest check; fall back to a one-word chat
		const response = await withTimeout(fetch(`${cleanBase(baseUrl)}/models`, { headers: headers(apiKey) }), 10000, "LLM check timed out");
		if (response.ok) {
			const json = await response.json();
			if (Array.isArray(json?.data)) return true;
		}
		return Boolean(await chat(baseUrl, apiKey, model, [{ role: "user", content: 'Say "hi"' }], 5));
	} catch (err) {
		return false;
	}
}

async function getLlmRecs(title, year, mediaType, apiKey, baseUrl, model) {
	try {
		const cleanedTitle = title.replace(/[^\p{L}\p{N} ]/gu, "");
		const system = await getGeminiSystemInstructions(mediaType);
		const prompt = await getGeminiPrompt(cleanedTitle, year, mediaType);
		const text = await chat(
			baseUrl,
			apiKey,
			model,
			[
				{ role: "system", content: system },
				{ role: "user", content: prompt },
			],
			2048,
		);
		if (!text) return null;
		return parseLlmReturn(text);
	} catch (error) {
		logger.error(error.message, null);
		return null;
	}
}

module.exports = { validateAPIKey, getLlmRecs, parseLlmReturn, cleanBase };
