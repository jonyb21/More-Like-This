function capitalize(str) {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

async function verifyApiKey(source) {
	const input = document.getElementById(`${source}ApiKey`);
	const button = document.querySelector(`#${source}ApiKey ~ .verify-btn`);
	const status = document.getElementById(`${source}-verify-status`);
	const valid = document.getElementById(`validated${capitalize(source)}ApiKey`);

	const apiKey = input.value.trim();

	// Reset states
	status.textContent = "";
	button.classList.remove("success", "error");
	status.classList.remove("success", "error");
	input.removeAttribute("data-valid");
	valid.value = "false";

	// Basic validation (My LLM may have no key; it needs an address)
	const llmBase = source === "llm" ? document.getElementById("llmBaseUrl").value.trim() : "";
	if (source === "llm" ? !llmBase : !apiKey) {
		status.textContent = source === "llm" ? "Please enter the address." : "Please enter a key.";
		status.classList.add("error");
		return;
	}

	// Indicate verifying
	button.classList.add("verifying");
	button.disabled = true;
	button.textContent = "Verifying...";

	try {
		const res = await fetch("/verifyKey", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(source === "llm" ? { source, key: apiKey, baseUrl: llmBase, model: document.getElementById("llmModel").value.trim() } : { source, key: apiKey }),
		});

		const data = await res.json();

		if (data.valid) {
			// UI feedback
			button.classList.add("success");
			status.classList.add("success");
			status.textContent = source === "llm" ? "Connected!" : "Valid key!";

			// Backend valid flags
			valid.value = "true";
			input.setAttribute("data-valid", "true");
		} else {
			status.classList.add("error");
			status.textContent = data.error || "Invalid key.";
		}
	} catch (err) {
		status.textContent = "Server error during validation.";
	} finally {
		button.disabled = false;
		button.classList.remove("verifying");
		button.textContent = "Verify Key";
	}
}

function setupValidationReset() {
	const sources = ["tmdb", "trakt", "gemini", "tastedive", "watchmode", "rpdb", "llm"];

	sources.forEach((source) => {
		const input = document.getElementById(`${source}ApiKey`);
		const button = document.querySelector(`#${source}ApiKey ~ .verify-btn`);
		const status = document.getElementById(`${source}-verify-status`);

		if (input && button && status) {
			input.addEventListener("input", () => {
				// Remove validation marker
				input.removeAttribute("data-valid");

				// Clear status messages and styles
				status.textContent = "";
				status.classList.remove("success", "error");

				// Reset verify button state
				button.disabled = false;
				button.classList.remove("success", "error", "verifying");
				button.textContent = "Verify Key";
			});
		}
	});
}

setupValidationReset();

// Changing the LLM address or model needs a new check too
["llmBaseUrl", "llmModel"].forEach((id) => {
	const el = document.getElementById(id);
	const key = document.getElementById("llmApiKey");
	if (el && key) el.addEventListener("input", () => key.dispatchEvent(new Event("input")));
});

// Show "Use the server's LLM" only when this server has one
fetch("/serverLlm")
	.then((r) => r.json())
	.then((info) => {
		if (!info.available) return;
		document.getElementById("serverLlmGroup").hidden = false;
		if (info.model) document.getElementById("serverLlmModel").textContent = ` (${info.model})`;
		const box = document.getElementById("useServerLlm");
		if (window.userConfig?.useServerLlm !== false) box.checked = true;
	})
	.catch(() => {});
