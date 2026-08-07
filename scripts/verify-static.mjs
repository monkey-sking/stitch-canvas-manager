import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/stitch-canvas-manager.user.js', import.meta.url), 'utf8');
const mustContain = [
  'snapshotInventory',
  'protectNodes',
  'listProtectedNodes',
  'createCleanupPlan',
  'loadCleanupPlan',
  'previewCleanup',
  'clearCleanupPreview',
  'locateDeletionTarget',
  'verifyCleanup',
  '布局包含未知页面 ID',
  '受保护页面不能成为清理候选',
  'model?.data?.source?.screen?.title',
  'span.truncate',
  'baselineNodes',
  'unexpectedMissing',
  'unexpectedAdded',
  'unexpectedChanged',
  'protectedMissing',
  'stillPresent',
];
const forbidden = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\b(delete|destroy)[A-Z]\w*\s*\(/,
  /node\.innerText/,
  /scrollIntoView\s*\(/,
  /GM\.setValue\(`?\$?\{?PREFIX\}?:last-layout/,
];

for (const value of mustContain) if (!source.includes(value)) throw new Error(`Missing required guardrail: ${value}`);
for (const pattern of forbidden) if (pattern.test(source)) throw new Error(`Forbidden privacy/destructive pattern: ${pattern}`);
if (!/protectedCandidates/.test(source) || !/unknownIds/.test(source)) throw new Error('Protected-candidate or unknown-ID handling is missing');
if (/\bdelete[A-Z]\w*\s*[,}:]/.test(source)) throw new Error('A delete-like public API is not allowed');
if (!/findReactFlowController/.test(source) || !/centerViewportFallback/.test(source)) throw new Error('Safe transformed-canvas location fallback is missing');
if (!/safeRefreshNodes/.test(source) || !/MutationObserver\(\(records\)/.test(source)) throw new Error('Async boot or mutation filtering is missing');
if (/参考图 ID 或标题关键词|目标稿 ID 或标题关键词/.test(source)) throw new Error('Mutation UI must require exact IDs');

const sandbox = { console, globalThis: null, process: { versions: { node: 'test' } }, window: null, __SCM_TEST_MODE__: 'node-vm-only' };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.runInNewContext(source, sandbox, { filename: 'stitch-canvas-manager.user.js' });
const hooks = sandbox.__SCM_TEST_EXPORTS__;
assert.ok(hooks, 'Userscript test hooks were not exposed');
assert.match(source, /const VERSION = '0\.3\.0'/);
assert.match(source, /version: VERSION/);
const plain = (value) => JSON.parse(JSON.stringify(value));

const plan = {
  schemaVersion: 1,
  candidateIds: ['candidate'],
  protectedIds: ['approved'],
  baselineNodes: [
    { id: 'approved', hidden: false },
    { id: 'candidate', hidden: false },
    { id: 'history', hidden: true },
  ],
  createdAt: '2026-08-07T00:00:00.000Z',
};
const current = [
  { id: 'approved', hidden: false },
  { id: 'candidate', hidden: true },
  { id: 'history', hidden: true },
  { id: 'added', hidden: false },
];
assert.deepEqual(plain(hooks.verificationReport(plan, current, [])), {
  stillPresent: [],
  protectedMissing: [],
  unexpectedMissing: [],
  unexpectedAdded: ['added'],
  unexpectedChanged: [],
});

const approvedMissing = current.map((node) => node.id === 'approved' ? { ...node, hidden: true } : node);
assert.deepEqual(plain(hooks.verificationReport(plan, approvedMissing, []).protectedMissing), ['approved']);

const historyExposed = current.map((node) => node.id === 'history' ? { ...node, hidden: false } : node);
assert.deepEqual(plain(hooks.verificationReport(plan, historyExposed, []).unexpectedChanged), ['history']);

const candidateStillVisible = current.map((node) => node.id === 'candidate' ? { ...node, hidden: false } : node);
assert.deepEqual(plain(hooks.verificationReport(plan, candidateStillVisible, []).stillPresent), ['candidate']);

assert.throws(
  () => hooks.verificationReport({ ...plan, protectedIds: ['candidate'] }, current, []),
  /受保护页面不能成为清理候选/,
);

const minimal = hooks.minimalCleanupPlan({
  ...plan,
  titles: ['private title'],
  coordinates: { x: 1, y: 2 },
  baselineNodes: [{ id: 'approved', hidden: false, title: 'private title', x: 1, y: 2 }],
});
assert.deepEqual(plain(Object.keys(minimal).sort()), ['baselineNodes', 'candidateIds', 'createdAt', 'protectedIds', 'schemaVersion', 'uncertainCandidateIds'].sort());
assert.deepEqual(plain(minimal.baselineNodes), [{ id: 'approved', hidden: false }]);
assert.equal(hooks.modelTitle({ data: { source: { screen: { title: 'Safe metadata title', prompt: 'private prompt' } } } }), 'Safe metadata title');
assert.equal(hooks.modelTitle({ data: { source: { prompt: 'private prompt' } } }), '');

assert.equal(hooks.isManagerMutation({ target: { closest: () => ({}) } }), true);
assert.equal(hooks.isManagerMutation({ target: { closest: () => null } }), false);

console.log('Static and behavioral cleanup guardrail checks passed.');
