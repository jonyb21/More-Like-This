// Makes name lookups sturdier for every outgoing request (node-fetch, needle,
// ioredis...). Seen on MINIBOY's Docker: lookups of v3-cinemeta.strem.io
// sometimes fail with EAI_AGAIN (the DNS server did not answer in time), which
// emptied catalogs and dropped titles. This wraps dns.lookup so that:
//   - EAI_AGAIN is retried (up to 3 more times, short waits)
//   - answers are remembered for 5 minutes, and an older answer is used if
//     every retry still fails
const dns = require("dns");

const TTL_MS = 5 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;
const WAITS_MS = [150, 400, 1000];

let originalLookup = dns.lookup;
const cache = new Map();

function cacheKey(hostname, options) {
	return `${hostname}|${typeof options === "object" ? JSON.stringify(options) : String(options)}`;
}

function lookupWithRetry(hostname, options, callback) {
	if (typeof options === "function") {
		callback = options;
		options = {};
	}
	if (options == null) options = {};

	const key = cacheKey(hostname, options);
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < TTL_MS) {
		return process.nextTick(() => callback(null, ...hit.result));
	}

	let attempt = 0;
	const tryOnce = () => {
		originalLookup.call(dns, hostname, options, (err, ...result) => {
			if (!err) {
				cache.set(key, { at: Date.now(), result });
				return callback(null, ...result);
			}
			if (err.code === "EAI_AGAIN" && attempt < WAITS_MS.length) {
				return setTimeout(tryOnce, WAITS_MS[attempt++]);
			}
			if (hit && Date.now() - hit.at < STALE_MS) {
				return callback(null, ...hit.result);
			}
			callback(err);
		});
	};
	tryOnce();
}

function install() {
	if (dns.lookup !== lookupWithRetry) dns.lookup = lookupWithRetry;
}

// For tests: replace the real lookup underneath
function _useLookup(fn) {
	originalLookup = fn;
	cache.clear();
}

module.exports = { install, lookupWithRetry, _useLookup };
