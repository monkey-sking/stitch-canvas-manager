// ==UserScript==
// @name         Stitch Canvas Manager
// @namespace    https://github.com/monkey-sking/stitch-canvas-manager
// @version      0.3.0
// @description  Privacy-first canvas inventory, layout, and non-destructive cleanup guardrails for Google Stitch.
// @author       monkey-sking
// @match        https://stitch.withgoogle.com/*
// @include      https://app-companion-*.appspot.com/*
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.registerMenuCommand
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/monkey-sking/stitch-canvas-manager/main/src/stitch-canvas-manager.user.js
// @downloadURL  https://raw.githubusercontent.com/monkey-sking/stitch-canvas-manager/main/src/stitch-canvas-manager.user.js
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '0.3.0';
  const PREFIX = 'scm';
  const NODE_SELECTOR = '.react-flow__node';
  const state = {
    labels: true,
    panel: null,
    overlay: null,
    nodes: new Map(),
    lastLayout: null,
    undoLayout: null,
    timer: 0,
    dragging: false,
    booted: false,
    bootTimer: 0,
    pollAttempts: 0,
    cleanupPreview: new Set(),
    cleanupCursor: 0,
    viewportRestore: null,
  };

  const text = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const css = (value) => String(value).replace(/["\\]/g, '\\$&');

  function isCanvasContext() {
    return Boolean(document.querySelector(NODE_SELECTOR));
  }

  function isWrapperContext() {
    return location.hostname === 'stitch.withgoogle.com';
  }

  function discoveryMode() {
    if (isWrapperContext()) return 'wrapper';
    if (state.nodes.size) return 'dom-canvas';
    if (document.querySelector(NODE_SELECTOR)) return 'dom-canvas';
    if (document.querySelector('canvas, [role="application"], .react-flow')) return 'visual-canvas';
    return 'waiting';
  }

  function discoveryStatus() {
    const mode = discoveryMode();
    if (mode === 'dom-canvas') return `DOM 画布 · ${state.nodes.size} 个页面 · 缩放 ${Math.round(canvasZoom() * 100)}%`;
    if (mode === 'visual-canvas') return '视觉画布 · 暂未发现可操作页面';
    if (mode === 'waiting') return '正在等待 Stitch 画布加载';
    return 'Stitch 外壳 · 请在画布内打开工具';
  }

  function getProjectId() {
    const match = location.href.match(/projects\/(\d+)/);
    return match ? match[1] : '';
  }

  function modelTitle(model) {
    const values = [model?.screenTitle, model?.title, model?.data?.source?.screen?.title, model?.data?.screenTitle, model?.data?.title, model?.data?.name];
    return values.map(text).find(Boolean) || '';
  }

  function titleChrome(node) {
    const chrome = node?.querySelector('span.truncate, [data-scm-title], [data-testid*="screen-title"], [aria-label][role="heading"]');
    return text(chrome?.textContent);
  }

  function nodeTitle(node, model) {
    return modelTitle(model) || titleChrome(node) || '未命名页面';
  }
  function parseTransform(node) {
    const style = node.getAttribute('style') || '';
    const match = style.match(/translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\s*\)/);
    return { x: match ? Number(match[1]) : 0, y: match ? Number(match[2]) : 0 };
  }

  function canvasZoom() {
    const viewport = document.querySelector('.react-flow__viewport');
    const transform = viewport?.getAttribute('style') || '';
    const match = transform.match(/scale\(([-\d.]+)\)/);
    return match ? Number(match[1]) || 1 : 1;
  }

  function refreshNodes() {
    const models = new Map(reactFlowProps().nodes.map((value) => [String(value.id), value]));
    const seen = new Set();
    document.querySelectorAll(NODE_SELECTOR).forEach((node) => {
      const id = node.getAttribute('data-id');
      if (!id) return;
      const rect = node.getBoundingClientRect();
      const model = models.get(id);
      const item = { id, title: nodeTitle(node, model), node, rect, ...parseTransform(node) };
      state.nodes.set(id, item);
      seen.add(id);
    });
    for (const id of state.nodes.keys()) if (!seen.has(id)) state.nodes.delete(id);
    renderLabels();
    updatePanelStatus();
  }

  function safeRefreshNodes() {
    try {
      refreshNodes();
      return state.nodes.size > 0;
    } catch (_) {
      updatePanelStatus();
      return false;
    }
  }

  function ensureOverlay() {
    if (state.overlay) return state.overlay;
    const overlay = document.createElement('div');
    overlay.id = `${PREFIX}-labels`;
    overlay.dataset.scmOverlay = 'true';
    overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;overflow:hidden;';
    document.body.appendChild(overlay);
    state.overlay = overlay;
    return overlay;
  }

  function ensureCleanupStyles() {
    if (document.getElementById(`${PREFIX}-cleanup-style`)) return;
    const style = document.createElement('style');
    style.id = `${PREFIX}-cleanup-style`;
    style.textContent = '[data-scm-cleanup-preview="true"]{outline:3px solid #c95d00!important;outline-offset:5px!important;}';
    document.head.appendChild(style);
  }

  function renderLabels() {
    const overlay = ensureOverlay();
    if (!state.labels) { overlay.replaceChildren(); return; }
    const used = new Set();
    for (const item of state.nodes.values()) {
      const { rect } = item;
      if (!rect.width || rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) continue;
      const key = `${PREFIX}-label-${item.id}`;
      let label = document.getElementById(key);
      if (!label) {
        label = document.createElement('div');
        label.id = key;
        label.style.cssText = 'position:fixed;max-width:220px;padding:3px 7px;border-radius:5px;background:rgba(20,24,31,.88);color:#fff;font:12px/1.25 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 1px 4px rgba(0,0,0,.22);pointer-events:none;';
        overlay.appendChild(label);
      }
      const left = `${Math.round(clamp(rect.left, 4, innerWidth - 224))}px`;
      const top = `${Math.round(clamp(rect.top - 24, 4, innerHeight - 28))}px`;
      if (label.textContent !== item.title) label.textContent = item.title;
      if (label.style.left !== left) label.style.left = left;
      if (label.style.top !== top) label.style.top = top;
      used.add(key);
    }
    [...overlay.children].forEach((child) => { if (!used.has(child.id)) child.remove(); });
  }

  function layoutDocument() {
    const nodes = {};
    for (const item of state.nodes.values()) nodes[item.id] = { title: item.title, x: item.x, y: item.y };
    return { schemaVersion: 1, projectId: getProjectId() || null, coordinateSpace: 'react-flow-logical', nodes };
  }

  function resolveExactNodeId(value) {
    const id = text(value);
    if (!id) throw new Error('请输入完整页面 ID');
    const node = state.nodes.get(id);
    if (!node) throw new Error(`找不到页面 ID: ${id}`);
    return node;
  }

  function sideBySideLayout(referenceId, targetId, gap = 80) {
    const reference = resolveExactNodeId(referenceId);
    const target = resolveExactNodeId(targetId);
    const zoom = canvasZoom();
    const referenceWidth = reference.rect.width / Math.max(zoom, 0.01);
    const next = layoutDocument();
    next.nodes[reference.id] = {
      title: reference.title,
      x: target.x - referenceWidth - Number(gap || 80),
      y: target.y,
    };
    return next;
  }

  function validateLayout(input) {
    if (!input || input.schemaVersion !== 1 || input.coordinateSpace !== 'react-flow-logical' || !input.nodes || typeof input.nodes !== 'object') throw new Error('布局格式不支持');
    if (input.projectId && getProjectId() && String(input.projectId) !== getProjectId()) throw new Error('布局项目与当前项目不一致');
    const result = {};
    const unknownIds = [];
    for (const [id, value] of Object.entries(input.nodes)) {
      if (!state.nodes.has(id)) { unknownIds.push(id); continue; }
      if (!Number.isFinite(Number(value.x)) || !Number.isFinite(Number(value.y))) throw new Error(`坐标无效: ${id}`);
      result[id] = { x: Number(value.x), y: Number(value.y) };
    }
    if (unknownIds.length) throw new Error(`布局包含未知页面 ID: ${unknownIds.join(', ')}`);
    return result;
  }

  function reactFlowProps() {
    const root = document.querySelector('.react-flow');
    if (!root) throw new Error('未找到 Stitch React Flow 画布');
    const fiberKey = Object.keys(root).find((key) => key.startsWith('__reactFiber$'));
    if (!fiberKey) throw new Error('未找到 Stitch React Flow 组件');
    let fiber = root[fiberKey];
    for (let depth = 0; fiber && depth < 12; depth += 1, fiber = fiber.return) {
      const props = fiber.memoizedProps;
      if (props && typeof props.onNodesChange === 'function' && Array.isArray(props.nodes)) return props;
    }
    throw new Error('未找到 React Flow onNodesChange 回调');
  }

  function inventoryNode(model) {
    const dom = state.nodes.get(model.id)?.node;
    const position = model.position || {};
    const dimensions = model.measured || model.dimensions || {};
    return {
      id: String(model.id),
      role: text(model.data?.role || model.role || model.type) || 'screen',
      hidden: Boolean(model.hidden),
      position: { x: Number(position.x) || 0, y: Number(position.y) || 0 },
      dimensions: { width: Number(dimensions.width || model.width) || 0, height: Number(dimensions.height || model.height) || 0 },
      title: nodeTitle(dom, model),
    };
  }

  function snapshotInventory() {
    return reactFlowProps().nodes.map(inventoryNode);
  }

  function projectStorageKey() {
    const projectId = getProjectId();
    if (!projectId) throw new Error('当前页面没有可用项目 ID，无法保存保护名单');
    return `${PREFIX}:protected:${projectId}`;
  }

  function cleanupPlanStorageKey() {
    const projectId = getProjectId();
    if (!projectId) throw new Error('当前页面没有可用项目 ID，无法保存清理计划');
    return `${PREFIX}:cleanup-plan:${projectId}`;
  }

  function minimalCleanupPlan(plan) {
    return {
      schemaVersion: 1,
      candidateIds: exactIds(plan?.candidateIds),
      uncertainCandidateIds: Array.isArray(plan?.uncertainCandidateIds) ? plan.uncertainCandidateIds.map(text).filter(Boolean) : [],
      protectedIds: Array.isArray(plan?.protectedIds) ? plan.protectedIds.map(text).filter(Boolean) : [],
      baselineNodes: Array.isArray(plan?.baselineNodes) ? plan.baselineNodes.map((node) => ({ id: text(node?.id), hidden: Boolean(node?.hidden) })).filter((node) => node.id) : [],
      createdAt: text(plan?.createdAt) || new Date().toISOString(),
    };
  }

  async function saveCleanupPlan(plan) {
    const minimal = minimalCleanupPlan(plan);
    await GM.setValue(cleanupPlanStorageKey(), minimal);
    return minimal;
  }

  async function loadCleanupPlan() {
    const stored = await GM.getValue(cleanupPlanStorageKey(), null);
    return stored ? minimalCleanupPlan(stored) : null;
  }

  function validProtectedEntry(value) {
    const id = text(value?.id);
    const role = text(value?.role).toLowerCase();
    if (!id) throw new Error('保护项必须提供完整页面 ID');
    if (!['final', 'reference', 'canonical', 'approved'].includes(role)) throw new Error('保护角色仅允许 final、reference、canonical 或 approved');
    return { id, role };
  }

  async function listProtectedNodes() {
    const stored = await GM.getValue(projectStorageKey(), []);
    return Array.isArray(stored) ? stored.map(validProtectedEntry) : [];
  }

  async function protectNodes(entries) {
    if (!Array.isArray(entries) || !entries.length) throw new Error('保护名单不能为空');
    const known = new Set(snapshotInventory().map((node) => node.id));
    const protectedNodes = entries.map(validProtectedEntry);
    const unknownIds = protectedNodes.filter((node) => !known.has(node.id)).map((node) => node.id);
    if (unknownIds.length) throw new Error(`保护名单包含未知页面 ID: ${unknownIds.join(', ')}`);
    const deduped = [...new Map(protectedNodes.map((node) => [node.id, node])).values()];
    await GM.setValue(projectStorageKey(), deduped);
    return deduped;
  }

  function exactIds(values) {
    if (!Array.isArray(values) || !values.length) throw new Error('清理计划必须提供完整候选页面 ID');
    const ids = values.map(text);
    if (ids.some((id) => !id)) throw new Error('清理计划包含空页面 ID');
    return [...new Set(ids)];
  }

  async function createCleanupPlan(input = {}) {
    const inventory = snapshotInventory();
    const known = new Set(inventory.map((node) => node.id));
    const candidateIds = exactIds(input.candidateIds);
    const unknownIds = candidateIds.filter((id) => !known.has(id));
    if (unknownIds.length) throw new Error(`清理计划包含未知页面 ID: ${unknownIds.join(', ')}`);
    const protectedIds = new Set((await listProtectedNodes()).map((node) => node.id));
    const protectedCandidates = candidateIds.filter((id) => protectedIds.has(id));
    if (protectedCandidates.length) throw new Error(`受保护页面不能成为清理候选: ${protectedCandidates.join(', ')}`);
    const titleRules = Array.isArray(input.titleRules) ? input.titleRules.map(text).filter(Boolean) : [];
    const uncertainCandidateIds = [...new Set(inventory.filter((node) => !protectedIds.has(node.id) && titleRules.some((rule) => node.title.toLowerCase().includes(rule.toLowerCase()))).map((node) => node.id))];
    return saveCleanupPlan({
      schemaVersion: 1,
      candidateIds,
      uncertainCandidateIds,
      protectedIds: [...protectedIds],
      baselineNodes: inventory.map((node) => ({ id: node.id, hidden: node.hidden })),
      createdAt: new Date().toISOString(),
    });
  }

  async function previewCleanup(plan) {
    const candidateIds = exactIds(plan?.candidateIds);
    const protectedIds = await protectedIdSet(plan);
    const protectedCandidates = candidateIds.filter((id) => protectedIds.has(id));
    if (protectedCandidates.length) throw new Error(`受保护页面不能预览: ${protectedCandidates.join(', ')}`);
    const known = new Set(snapshotInventory().map((node) => node.id));
    const unknownIds = candidateIds.filter((id) => !known.has(id));
    if (unknownIds.length) throw new Error(`预览包含未知页面 ID: ${unknownIds.join(', ')}`);
    clearCleanupPreview();
    state.cleanupPreview = new Set(candidateIds);
    candidateIds.forEach((id) => state.nodes.get(id)?.node.setAttribute('data-scm-cleanup-preview', 'true'));
    return { candidateIds, protectedIds: [...protectedIds] };
  }

  function clearCleanupPreview() {
    document.querySelectorAll('[data-scm-cleanup-preview]').forEach((node) => node.removeAttribute('data-scm-cleanup-preview'));
    state.cleanupPreview.clear();
    state.cleanupCursor = 0;
    if (state.viewportRestore) {
      if (state.viewportRestore.element.style.transform === state.viewportRestore.appliedTransform) {
        state.viewportRestore.element.style.transform = state.viewportRestore.transform;
      }
      state.viewportRestore = null;
    }
  }

  async function protectedIdSet(plan) {
    const planIds = Array.isArray(plan?.protectedIds) ? plan.protectedIds.map(text).filter(Boolean) : [];
    const currentIds = (await listProtectedNodes()).map((node) => node.id);
    return new Set([...planIds, ...currentIds]);
  }

  function findReactFlowController(props) {
    const candidates = [props?.setCenter, props?.reactFlowInstance?.setCenter, props?.instance?.setCenter];
    return candidates.find((candidate) => typeof candidate === 'function') || null;
  }

  function centerViewportFallback(item) {
    const root = document.querySelector('.react-flow');
    const viewport = root?.querySelector('.react-flow__viewport');
    if (!root || !viewport) throw new Error('未找到可定位的 React Flow 视口');
    const rootRect = root.getBoundingClientRect();
    const transform = viewport.style.transform || '';
    const scaleMatch = transform.match(/scale\(([-\d.]+)\)/);
    const scale = scaleMatch ? Number(scaleMatch[1]) || 1 : 1;
    const centerX = item.x + item.rect.width / Math.max(canvasZoom(), 0.01) / 2;
    const centerY = item.y + item.rect.height / Math.max(canvasZoom(), 0.01) / 2;
    const x = rootRect.width / 2 - centerX * scale;
    const y = rootRect.height / 2 - centerY * scale;
    const appliedTransform = `translate(${Math.round(x)}px, ${Math.round(y)}px) scale(${scale})`;
    if (!state.viewportRestore) state.viewportRestore = { element: viewport, transform, appliedTransform };
    else state.viewportRestore.appliedTransform = appliedTransform;
    viewport.style.transform = appliedTransform;
  }

  async function locateDeletionTarget(plan) {
    const candidateIds = exactIds(plan?.candidateIds);
    if (!candidateIds.length) return null;
    const protectedIds = await protectedIdSet(plan);
    const protectedCandidates = candidateIds.filter((id) => protectedIds.has(id));
    if (protectedCandidates.length) throw new Error(`受保护页面不能定位为清理候选: ${protectedCandidates.join(', ')}`);
    const index = state.cleanupCursor % candidateIds.length;
    const id = candidateIds[index];
    state.cleanupCursor = (index + 1) % candidateIds.length;
    const node = state.nodes.get(id)?.node;
    if (!node) throw new Error(`找不到候选页面: ${id}`);
    const item = state.nodes.get(id);
    const props = reactFlowProps();
    const setCenter = findReactFlowController(props);
    if (setCenter) {
      const x = item.x + item.rect.width / Math.max(canvasZoom(), 0.01) / 2;
      const y = item.y + item.rect.height / Math.max(canvasZoom(), 0.01) / 2;
      setCenter(x, y, { duration: 250 });
    } else {
      centerViewportFallback(item);
      if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
      node.focus({ preventScroll: true });
    }
    node.setAttribute('data-scm-cleanup-preview', 'true');
    return { id, index, total: candidateIds.length };
  }

  function verificationReport(plan, current, currentProtectedIds = []) {
    const candidateIds = exactIds(plan?.candidateIds);
    const byId = new Map(current.map((node) => [node.id, node]));
    const baselineNodes = Array.isArray(plan?.baselineNodes)
      ? plan.baselineNodes.filter((node) => node && text(node.id)).map((node) => ({ id: text(node.id), hidden: Boolean(node.hidden) }))
      : (Array.isArray(plan?.baselineIds) ? plan.baselineIds.map((id) => ({ id: text(id), hidden: false })).filter((node) => node.id) : []);
    const baselineIds = baselineNodes.map((node) => node.id);
    const protectedIds = [...new Set([
      ...(Array.isArray(plan?.protectedIds) ? plan.protectedIds.map(text).filter(Boolean) : []),
      ...currentProtectedIds.map(text).filter(Boolean),
    ])];
    const protectedCandidates = candidateIds.filter((id) => protectedIds.includes(id));
    if (protectedCandidates.length) throw new Error(`受保护页面不能成为清理候选: ${protectedCandidates.join(', ')}`);
    const stillPresent = candidateIds.filter((id) => byId.has(id) && !byId.get(id).hidden);
    const protectedMissing = protectedIds.filter((id) => !byId.has(id) || byId.get(id).hidden);
    const expectedRemoved = new Set(candidateIds);
    const unexpectedMissing = baselineNodes.filter((node) => !node.hidden && !expectedRemoved.has(node.id) && (!byId.has(node.id) || byId.get(node.id).hidden)).map((node) => node.id);
    const unexpectedAdded = baselineIds.length ? current.filter((node) => !baselineIds.includes(node.id)).map((node) => node.id) : [];
    const unexpectedChanged = baselineNodes.filter((node) => node.hidden && byId.has(node.id) && !byId.get(node.id).hidden).map((node) => node.id);
    return { stillPresent, protectedMissing, unexpectedMissing, unexpectedAdded, unexpectedChanged };
  }

  async function verifyCleanup(plan) {
    const current = snapshotInventory();
    const currentProtectedIds = (await listProtectedNodes()).map((node) => node.id);
    return verificationReport(plan, current, currentProtectedIds);
  }

  function applyReactFlowPositions(changed) {
    if (!changed.length) return;
    const props = reactFlowProps();
    props.onNodesChange(changed.map(([id, position]) => ({
      id,
      type: 'position',
      position: { x: Number(position.x), y: Number(position.y) },
      dragging: false,
    })));
  }

  async function applyLayout(input) {
    if (state.dragging) return;
    const targets = validateLayout(input);
    state.undoLayout = layoutDocument();
    state.dragging = true;
    const changed = Object.entries(targets).filter(([id, target]) => Math.abs(state.nodes.get(id).x - target.x) > 1 || Math.abs(state.nodes.get(id).y - target.y) > 1);
    try {
      // Stitch's current build persists coordinates through React Flow's callback;
      // synthetic mouse events update neither the backing store nor MCP readback.
      applyReactFlowPositions(changed);
      await new Promise((resolve) => setTimeout(resolve, 450));
      refreshNodes();
      const failed = changed.filter(([id, target]) => {
        const current = state.nodes.get(id);
        return !current || Math.abs(current.x - target.x) > 1 || Math.abs(current.y - target.y) > 1;
      });
      if (failed.length) throw new Error(`${failed.length} 个页面未能通过 React Flow 保存`);
      state.lastLayout = input;
      updatePanelStatus(`${changed.length} 个页面已保存`);
    } finally {
      state.dragging = false;
    }
  }

  function addButton(parent, label, action) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = label; button.addEventListener('click', action);
    button.style.cssText = 'border:1px solid #c7ccd4;border-radius:6px;background:#fff;padding:6px 9px;font:12px -apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer;';
    parent.appendChild(button); return button;
  }

  function updatePanelStatus(message = '') {
    const status = state.panel?.querySelector('[data-scm-status]');
    const next = message || discoveryStatus();
    if (status && status.textContent !== next) status.textContent = next;
  }

  function createPanel() {
    if (state.panel) { state.panel.remove(); state.panel = null; return; }
    const panel = document.createElement('section');
    panel.id = `${PREFIX}-panel`;
    panel.dataset.scmPanel = 'true';
    panel.style.cssText = 'position:fixed;right:18px;top:72px;z-index:2147483001;width:330px;padding:12px;border:1px solid #c7ccd4;border-radius:10px;background:rgba(248,249,251,.97);box-shadow:0 8px 30px rgba(0,0,0,.18);font:13px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;color:#20242a;';
    const heading = document.createElement('strong'); heading.textContent = 'Stitch Canvas Manager'; panel.appendChild(heading);
    const status = document.createElement('div'); status.dataset.scmStatus = ''; status.style.cssText = 'margin:7px 0;color:#596273;font-size:12px;'; panel.appendChild(status);
    const input = document.createElement('textarea'); input.placeholder = '粘贴布局 JSON'; input.style.cssText = 'width:100%;height:120px;box-sizing:border-box;font:11px/1.35 ui-monospace,monospace;'; panel.appendChild(input);
    const reference = document.createElement('input'); reference.placeholder = '参考图完整 ID'; reference.style.cssText = 'width:100%;box-sizing:border-box;margin-top:6px;padding:6px;font:12px -apple-system,BlinkMacSystemFont,sans-serif;'; panel.appendChild(reference);
    const target = document.createElement('input'); target.placeholder = '目标稿完整 ID'; target.style.cssText = 'width:100%;box-sizing:border-box;margin-top:6px;padding:6px;font:12px -apple-system,BlinkMacSystemFont,sans-serif;'; panel.appendChild(target);
    const gap = document.createElement('input'); gap.type = 'number'; gap.value = '80'; gap.min = '0'; gap.step = '10'; gap.title = '逻辑坐标间距'; gap.style.cssText = 'width:100%;box-sizing:border-box;margin-top:6px;padding:6px;font:12px -apple-system,BlinkMacSystemFont,sans-serif;'; panel.appendChild(gap);
    const actions = document.createElement('div'); actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;'; panel.appendChild(actions);
    addButton(actions, state.labels ? '隐藏标题' : '显示标题', () => { state.labels = !state.labels; renderLabels(); createPanel(); });
    addButton(actions, '导出布局', () => { input.value = JSON.stringify(layoutDocument(), null, 2); });
    addButton(actions, '预览校验', () => { try { const value = JSON.parse(input.value); const targets = validateLayout(value); updatePanelStatus(`可识别 ${Object.keys(targets).length} 个页面`); } catch (error) { updatePanelStatus(error.message); } });
    addButton(actions, '应用布局', async () => { try { await applyLayout(JSON.parse(input.value)); } catch (error) { updatePanelStatus(error.message); } });
    addButton(actions, '参考图放到目标左侧', async () => { try { input.value = JSON.stringify(sideBySideLayout(reference.value, target.value, gap.value), null, 2); await applyLayout(JSON.parse(input.value)); } catch (error) { updatePanelStatus(error.message); } });
    addButton(actions, '撤销', async () => { if (state.undoLayout) await applyLayout(state.undoLayout); });
    const cleanup = document.createElement('div'); cleanup.style.cssText = 'margin-top:12px;padding-top:10px;border-top:1px solid #d9dde4;'; panel.appendChild(cleanup);
    const cleanupHeading = document.createElement('strong'); cleanupHeading.textContent = '清理保护与预览'; cleanup.appendChild(cleanupHeading);
    const protectedInput = document.createElement('textarea'); protectedInput.placeholder = '保护项，每行: 完整 ID,role'; protectedInput.style.cssText = 'width:100%;height:48px;box-sizing:border-box;margin-top:6px;font:11px/1.35 ui-monospace,monospace;'; cleanup.appendChild(protectedInput);
    const candidateInput = document.createElement('textarea'); candidateInput.placeholder = '候选项，仅完整 ID，每行一个'; candidateInput.style.cssText = 'width:100%;height:48px;box-sizing:border-box;margin-top:6px;font:11px/1.35 ui-monospace,monospace;'; cleanup.appendChild(candidateInput);
    const cleanupActions = document.createElement('div'); cleanupActions.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;'; cleanup.appendChild(cleanupActions);
    let cleanupPlan = null;
    const parseLines = (value) => value.split(/\n|,/).map(text).filter(Boolean);
    const loadProtected = async () => {
      const entries = await listProtectedNodes();
      protectedInput.value = entries.map((entry) => `${entry.id},${entry.role}`).join('\n');
      return entries;
    };
    const loadPlan = async () => {
      cleanupPlan = await loadCleanupPlan();
      if (cleanupPlan) candidateInput.value = cleanupPlan.candidateIds.join('\n');
      return cleanupPlan;
    };
    const requirePlan = async () => {
      cleanupPlan ||= await loadCleanupPlan();
      if (!cleanupPlan) throw new Error('请先用完整 ID 创建预览');
      return cleanupPlan;
    };
    addButton(cleanupActions, '保存保护', async () => { try {
      const entries = protectedInput.value.split('\n').map(text).filter(Boolean).map((line) => {
        const [id, role, extra] = line.split(',').map(text);
        if (extra !== undefined) throw new Error('保护项格式为: 完整 ID,role');
        return { id, role };
      });
      const saved = await protectNodes(entries); updatePanelStatus(`已保护 ${saved.length} 个页面`);
    } catch (error) { updatePanelStatus(error.message); } });
    addButton(cleanupActions, '查看保护', async () => { try { const entries = await loadProtected(); updatePanelStatus(`已保护 ${entries.length} 个页面`); } catch (error) { updatePanelStatus(error.message); } });
    addButton(cleanupActions, '预览候选', async () => { try { cleanupPlan = await createCleanupPlan({ candidateIds: parseLines(candidateInput.value) }); await previewCleanup(cleanupPlan); updatePanelStatus(`仅预览 ${cleanupPlan.candidateIds.length} 个候选页面`); } catch (error) { updatePanelStatus(error.message); } });
    addButton(cleanupActions, '载入计划', async () => { try { const plan = await loadPlan(); updatePanelStatus(plan ? `已恢复 ${plan.candidateIds.length} 个候选` : '没有已保存的清理计划'); } catch (error) { updatePanelStatus(error.message); } });
    addButton(cleanupActions, '定位下一个', async () => { try { const target = await locateDeletionTarget(await requirePlan()); updatePanelStatus(target ? `定位 ${target.index + 1}/${target.total}: ${target.id}` : '没有候选页面'); } catch (error) { updatePanelStatus(error.message); } });
    addButton(cleanupActions, '验证清理', async () => { try { const result = await verifyCleanup(await requirePlan()); updatePanelStatus(`仍可见 ${result.stillPresent.length} · 保护缺失 ${result.protectedMissing.length} · 意外缺失 ${result.unexpectedMissing.length} · 意外新增 ${result.unexpectedAdded.length} · 状态变化 ${result.unexpectedChanged.length}`); } catch (error) { updatePanelStatus(error.message); } });
    addButton(cleanupActions, '清除预览', () => { clearCleanupPreview(); updatePanelStatus('已清除预览'); });
    document.body.appendChild(panel); state.panel = panel; updatePanelStatus();
    Promise.all([loadProtected(), loadPlan()]).then(([, plan]) => {
      if (plan) updatePanelStatus(`已恢复 ${plan.candidateIds.length} 个清理候选`);
    }).catch((error) => updatePanelStatus(error.message));
  }

  function isManagerMutation(record) {
    const element = record?.target?.closest ? record.target : record?.target?.parentElement;
    return Boolean(element?.closest?.('[data-scm-overlay], [data-scm-panel], [data-scm-badge], #scm-cleanup-style'));
  }

  const isNodeTest = typeof process !== 'undefined' && Boolean(process.versions?.node) && globalThis.__SCM_TEST_MODE__ === 'node-vm-only';
  if (isNodeTest) {
    globalThis.__SCM_TEST_EXPORTS__ = Object.freeze({
      isManagerMutation,
      minimalCleanupPlan,
      modelTitle,
      verificationReport,
    });
    return;
  }

  window.StitchCanvasManager = Object.freeze({
    version: VERSION,
    exportLayout: () => layoutDocument(),
    sideBySideLayout,
    applyLayout,
    refresh: safeRefreshNodes,
    snapshotInventory,
    protectNodes,
    listProtectedNodes,
    createCleanupPlan,
    loadCleanupPlan,
    previewCleanup,
    clearCleanupPreview,
    locateDeletionTarget,
    verifyCleanup,
  });

  function cleanupWrapperArtifacts() {
    document.querySelectorAll('[title^="Stitch Canvas Manager"], #scm-panel, #scm-labels').forEach((element) => element.remove());
  }

  function boot() {
    if (state.booted) return;
    state.booted = true;
    if (isWrapperContext()) { cleanupWrapperArtifacts(); return; }
    ensureOverlay();
    ensureCleanupStyles();
    const observer = new MutationObserver((records) => {
      if (!records.some((record) => !isManagerMutation(record))) return;
      window.clearTimeout(state.timer);
      state.timer = window.setTimeout(safeRefreshNodes, 60);
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] });
    window.addEventListener('resize', renderLabels, { passive: true });
    window.addEventListener('scroll', renderLabels, { passive: true });
    window.addEventListener('keydown', (event) => { if (event.altKey && event.key.toLowerCase() === 'l') { event.preventDefault(); createPanel(); } });
    GM.registerMenuCommand('Stitch Canvas Manager', createPanel);
    const badge = document.createElement('div');
    badge.dataset.scmBadge = 'true';
    badge.textContent = 'SCM';
    badge.title = `Stitch Canvas Manager ${VERSION} 已加载，按 Alt+L 打开工具`;
    badge.addEventListener('click', createPanel);
    badge.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483001;padding:3px 6px;border-radius:4px;background:#20242a;color:#fff;font:10px -apple-system,BlinkMacSystemFont,sans-serif;opacity:.72;cursor:pointer;';
    document.body.appendChild(badge);
    const poll = () => {
      const ready = safeRefreshNodes();
      state.pollAttempts += 1;
      if (!ready && state.pollAttempts < 120) state.bootTimer = window.setTimeout(poll, 500);
    };
    poll();
  }

  boot();
})();
