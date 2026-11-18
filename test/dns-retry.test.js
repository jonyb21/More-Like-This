// The DNS wrapper: retries EAI_AGAIN, remembers answers, falls back to an old answer.
const test = require("node:test");
const assert = require("node:assert");
const d = require("../utils/dnsRetry");

const again = () => Object.assign(new Error("getaddrinfo EAI_AGAIN host"), { code: "EAI_AGAIN" });
const look = (host, opts) => new Promise((resolve) => d.lookupWithRetry(host, opts, (err, address, family) => resolve({ err, address, family })));

test("retries a timed-out lookup and then succeeds", async () => {
	let calls = 0;
	d._useLookup((h, o, cb) => (++calls < 3 ? cb(again()) : cb(null, "1.2.3.4", 4)));
	const r = await look("v3-cinemeta.strem.io", {});
	assert.deepStrictEqual([r.err, r.address, r.family, calls], [null, "1.2.3.4", 4, 3]);
});

test("remembers an answer, so the next lookup needs no DNS", async () => {
	let calls = 0;
	d._useLookup((h, o, cb) => (calls++, cb(null, "5.6.7.8", 4)));
	await look("a.example", {});
	const r = await look("a.example", {});
	assert.strictEqual(r.address, "5.6.7.8");
	assert.strictEqual(calls, 1);
});

test("gives up after 4 tries when there is no earlier answer", async () => {
	let calls = 0;
	d._useLookup((h, o, cb) => (calls++, cb(again())));
	const r = await look("b.example", {});
	assert.strictEqual(r.err.code, "EAI_AGAIN");
	assert.strictEqual(calls, 4);
});

test("other errors are not retried", async () => {
	let calls = 0;
	d._useLookup((h, o, cb) => (calls++, cb(Object.assign(new Error("nope"), { code: "ENOTFOUND" }))));
	const r = await look("c.example", {});
	assert.strictEqual(r.err.code, "ENOTFOUND");
	assert.strictEqual(calls, 1);
});

test("all:true answers pass through unchanged", async () => {
	d._useLookup((h, o, cb) => cb(null, [{ address: "9.9.9.9", family: 4 }]));
	const r = await new Promise((resolve) => d.lookupWithRetry("d.example", { all: true }, (err, list) => resolve(list)));
	assert.deepStrictEqual(r, [{ address: "9.9.9.9", family: 4 }]);
});
