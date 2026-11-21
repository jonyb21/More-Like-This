# This fork: places in Stremio

This fork adds three places where the addon's picks show up in Stremio. Each place has a switch on the settings page, under "Places in Stremio".

| Switch | What it adds |
| --- | --- |
| Rows on Home | Three Home rows about the title you opened last: "Same series" (movies only), "More from the director" ("More from the creator" for series) and "Similar story". Each title appears under one reason only. The first two rows need a TMDB key. |
| Picker in Discover | A "More Like This" catalog in Discover. Its drop-down holds "Last opened" to "5 titles ago" for that type. Results are the whole list, in the order Same series, director, Similar story. |
| Entry on each title page | An entry at the top of the stream list, "Open the list in Discover". It opens the picker for that title. It needs the picker catalog, so this switch keeps that catalog in the manifest. |
| Notice series pages too | Stremio only asks for streams once an episode is picked. With this on, the addon also asks for `tt` pages and answers 404, so opening a series page counts. Put the addon below Cinemeta. |

## My LLM

A recommendation source next to Gemini, for any OpenAI-compatible server (llama.cpp, vLLM, Ollama, LM Studio, OpenRouter). It gets the same prompt as Gemini, gets its own "My LLM Recommendations" catalog and joins the combined list. Two ways to set it up:

- On the settings page: address (ending in /v1), model and key. These go into the install link, like every other key.
- On the server: `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`. The settings page then shows "Use the server's LLM", and the address and key never leave the server.

Reasoning blocks (`<think>...</think>`), numbering and bullets are stripped from the answer. `LLM_TIMEOUT_MS` (default 60000) is how long the "My LLM" row waits; each answer is cached per title. The combined row waits only `LLM_COMBINED_WAIT_MS` (default 5000, the same as the other sources): a slower answer keeps going in the background, is cached, and joins the combined row on the next search of that title. Rows that ask about the same title at the same time share one LLM request.

## How "what you opened" is known

The addon notes each stream request (movie pages ask for streams when they open) and, with the last switch on, each `tt` page request. It keeps the last 20 IMDb ids for each install, newest first. An install is one manifest URL, so there is no login. The ids live in one JSON file.

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `HISTORY_FILE` | `data/history/history.json` | Where the history is kept. Mount `data/history` as a volume in Docker. |
| `PUBLIC_URL` | (empty) | The address Stremio uses, such as `http://192.168.4.29:7000`. Without it, home-network addresses get `http` and others `https`. |
| `ID_MAP` | (off) | `on` loads upstream's Watchmode id map (about 700 MB of memory). Off, ids are looked up through the TMDB/Watchmode APIs instead and the addon uses about 80 MB. |
| `ENCRYPTION_KEY` | (empty) | As upstream. Without it, the config is plain JSON in the URL. This fork reads that plain config; upstream ignored it. |

## Not yet checked on a TV

- Whether the Android TV app hides the empty rows (the rows for the other type stay empty).
- When the Android TV app reloads Home rows after a title is opened.
- Whether `stremio:///discover/...?genre=tt...` opens the picker on the TV app.
- Whether a 404 on `tt` meta stays silent on the TV app.
- The creator row for series: TMDB `tv_credits` job names were taken from its docs, not tried with a real key.

`npm test` runs the checks (no network needed).
