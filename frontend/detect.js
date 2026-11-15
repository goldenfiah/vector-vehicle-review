/* VECTOR detect lab — independent canvas implementation. */
(function () {
  'use strict';

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const clone = v => JSON.parse(JSON.stringify(v));
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SCENE = window.TL_SCENE;
  const AI_KEY = 'vector.ai.v1';

  const state = {
    media: null,
    dets: [],
    selected: null,
    engine: 'local',
    view: { s: 1, ox: 0, oy: 0, dpr: 1 },
    dragging: null,
    space: false,
    ai: readAI()
  };

  const C = { model: '#6f8b80', ai: '#b38a4e', manual: '#1f4b43' };

  function toast(text, kind) {
    const host = $('#lab-toasts');
    const el = document.createElement('div');
    el.className = 'toast' + (kind === 'err' ? ' err' : '');
    el.textContent = text;
    host.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; }, 2400);
    setTimeout(() => el.remove(), 2900);
  }

  function readAI() {
    try { return JSON.parse(localStorage.getItem(AI_KEY)) || {}; } catch (_) { return {}; }
  }
  const aiReady = () => !!(state.ai.endpoint && state.ai.endpoint.trim());

  function loadImage(src, name) {
    const img = new Image();
    img.onload = () => {
      state.media = { img, width: img.naturalWidth, height: img.naturalHeight, name };
      fit();
      draw();
      $('#lab-name').textContent = name;
      $('#lab-dim').textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
      $('#lab-media').textContent = name.toUpperCase();
    };
    img.onerror = () => toast('影像加载失败', 'err');
    img.src = src;
  }

  function fit() {
    const c = $('#lab-canvas');
    if (!c || !state.media) return;
    const w = c.clientWidth, h = c.clientHeight;
    const dpr = Math.min(2, devicePixelRatio || 1);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const s = Math.min(w / state.media.width, h / state.media.height) * .92;
    state.view = { s, ox: (w - state.media.width * s) / 2, oy: (h - state.media.height * s) / 2, dpr };
    $('#lab-zoom').textContent = Math.round(s * 100) + '%';
  }

  function draw() {
    const c = $('#lab-canvas');
    if (!c || !state.media) return;
    const ctx = c.getContext('2d');
    const { dpr, s, ox, oy } = state.view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, c.clientWidth, c.clientHeight);
    ctx.drawImage(state.media.img, ox, oy, state.media.width * s, state.media.height * s);
    ctx.strokeStyle = 'rgba(199,91,54,.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox, oy, state.media.width * s, state.media.height * s);
    for (const d of state.dets) {
      const pts = d.polygon.map(p => [ox + p[0] * s, oy + p[1] * s]);
      ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
      ctx.closePath();
      const active = d.id === state.selected;
      ctx.lineWidth = active ? 2.5 : 1.3;
      ctx.strokeStyle = active ? '#f0b24e' : (d.origin === 'ai' ? C.ai : C.model);
      ctx.stroke();
      if (active) { ctx.fillStyle = 'rgba(240,178,78,.15)'; ctx.fill(); }
      ctx.font = '9px "IBM Plex Mono", monospace';
      const label = '#' + d.id;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(11,26,22,.82)';
      ctx.fillRect(pts[0][0], pts[0][1] - 13, tw + 8, 13);
      ctx.fillStyle = '#fbf7ee';
      ctx.fillText(label, pts[0][0] + 4, pts[0][1] - 3);
    }
  }

  function hit(x, y) {
    const { s, ox, oy } = state.view;
    return state.dets.slice().reverse().find(d => pointIn(x, y, d.polygon.map(p => [ox + p[0] * s, oy + p[1] * s])));
  }

  function pointIn(x, y, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  function renderList() {
    const list = $('#lab-list');
    $('#lab-count').textContent = state.dets.length;
    $('#lab-list-count').textContent = state.dets.length;
    $('#lab-export').disabled = !state.dets.length;
    $('#lab-clear').disabled = !state.dets.length;
    list.innerHTML = state.dets.length ? state.dets.map(d => `<div class="lab-item ${d.id === state.selected ? 'on' : ''}" data-id="${d.id}">
      <i style="background:${d.origin === 'ai' ? C.ai : C.model}"></i>
      <span>#${String(d.id).padStart(2, '0')} · ${esc(d.label || 'vehicle')}</span>
      <em>${Number(d.score || 0).toFixed(2)}</em>
    </div>`).join('') : '<div class="lab-empty">还没有目标</div>';
  }

  function renderInspector() {
    const d = state.dets.find(x => x.id === state.selected);
    $('#lab-sel-id').textContent = d ? '#' + d.id : '—';
    const host = $('#lab-inspector');
    if (!d) { host.innerHTML = '<div class="lab-empty"><b>未选择目标</b>点击画布或列表中的框，查看中心、尺寸与四角坐标。</div>'; return; }
    const xs = d.polygon.map(p => p[0]), ys = d.polygon.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    host.innerHTML = `<div class="mono" style="color:var(--orange)">${d.origin === 'ai' ? 'AI CANDIDATE' : 'MODEL / T' + d.tile}</div>
      <h2>${esc(d.label || 'vehicle')} <span class="tag ${d.origin === 'ai' ? 'orange' : 'green'}">${d.origin === 'ai' ? 'AI' : '模型'}</span></h2>
      <dl class="lab-kv">
        <dt>置信度</dt><dd>${Number(d.score || 0).toFixed(3)}</dd>
        <dt>中心</dt><dd>${cx.toFixed(1)}, ${cy.toFixed(1)}</dd>
        <dt>宽 × 高</dt><dd>${(Math.max(...xs) - Math.min(...xs)).toFixed(1)} × ${(Math.max(...ys) - Math.min(...ys)).toFixed(1)}</dd>
        <dt>点数</dt><dd>${d.polygon.length}</dd>
      </dl>
      <div class="lab-poly">${d.polygon.map(p => `[${p[0].toFixed(1)}, ${p[1].toFixed(1)}]`).join(' · ')}</div>
      <button class="tl-btn small danger" id="lab-delete">删除此框</button>`;
    host.classList.remove('flash');
    void host.offsetWidth;
    host.classList.add('flash');
    $('#lab-delete').addEventListener('click', deleteSelected);
  }

  function updateButtons() {
    $('#lab-export').disabled = !state.dets.length;
    $('#lab-clear').disabled = !state.dets.length;
  }

  function select(id) {
    state.selected = id;
    renderList();
    renderInspector();
    draw();
  }

  function deleteSelected() {
    const d = state.dets.find(x => x.id === state.selected);
    if (!d) return toast('请先选择一个框', 'err');
    state.dets = state.dets.filter(x => x.id !== d.id);
    state.selected = null;
    renderList();
    renderInspector();
    draw();
    toast('已删除 #' + d.id);
  }

  function clearAll() {
    if (!state.dets.length) return;
    if (!window.confirm(`清空当前影像的全部 ${state.dets.length} 个框？`)) return;
    state.dets = [];
    state.selected = null;
    renderList();
    renderInspector();
    draw();
    toast('已清空全部框');
  }

  function triggerScan(ms) {
    const stage = $('#lab-stage');
    if (!stage) return;
    stage.classList.add('scanning');
    clearTimeout(state.scanTimer);
    state.scanTimer = setTimeout(() => stage.classList.remove('scanning'), ms || 900);
  }

  function bumpCount() {
    const el = $('#lab-count');
    if (!el) return;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  async function runDetect() {
    if (!state.media) return toast('请先载入影像', 'err');
    const btn = $('#lab-detect');
    if (btn.disabled) return;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner btn-spin"></span>检测中…';
    triggerScan(1600);
    $('#lab-status').textContent = '模型推理中…';
    try {
      const full = document.createElement('canvas');
      full.width = state.media.width;
      full.height = state.media.height;
      const fctx = full.getContext('2d');
      fctx.drawImage(state.media.img, 0, 0, full.width, full.height);
      const dataUrl = full.toDataURL('image/jpeg', .86);
      const res = await window.VECTOR_MODEL.detect({
        dataUrl, width: state.media.width, height: state.media.height,
        name: state.media.name
      });
      const dets = (res.detections || [])
        .filter(d => d && Array.isArray(d.polygon) && d.polygon.length >= 3)
        .map((d, i) => ({
          id: Number.isFinite(Number(d.id)) ? Number(d.id) : i + 1,
          polygon: d.polygon,
          label: d.label || 'vehicle',
          score: Number(d.score != null ? d.score : d.confidence) || 0,
          tile: d.source_tile_id != null ? d.source_tile_id : 0,
          origin: 'model'
        }));
      if (!dets.length) throw new Error('模型没有返回检测框');
      state.dets = dets;
      state.engine = 'model';
      state.selected = null;
      renderList();
      renderInspector();
      draw();
      bumpCount();
      $('#lab-status').textContent = '模型已返回';
      $('#lab-engine').textContent = 'MODEL / HTTP';
      toast(`模型返回 ${dets.length} 个目标` + (res.elapsed != null ? ` · ${Math.round(res.elapsed)} ms` : ''));
    } catch (err) {
      state.dets = clone(SCENE.detections);
      state.engine = 'local';
      state.selected = null;
      renderList();
      renderInspector();
      draw();
      bumpCount();
      $('#lab-status').textContent = '模型未连接 · 演示结果';
      $('#lab-engine').textContent = 'LOCAL / MOCK';
      toast('模型服务未连接，已切换演示结果', 'err');
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  function openAI() {
    const dlg = $('#lab-dialog');
    $('#lab-ai-endpoint').value = state.ai.endpoint || '';
    $('#lab-ai-key').value = state.ai.key || '';
    $('#lab-ai-model').value = state.ai.model || '';
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }

  function updateAI() {
    $('#lab-ai-state').textContent = aiReady() ? '已接入' : '未接入';
    $('#lab-ai-state').className = 'tag ' + (aiReady() ? 'green' : '');
    $('#lab-ai-note').textContent = aiReady()
      ? 'Custom endpoint · ' + state.ai.endpoint
      : 'POST /vision/segment · 未配置时走演示接口';
    $('#lab-engine').textContent = state.engine === 'model' ? 'MODEL / HTTP' : 'LOCAL / MOCK';
  }

  function saveAI() {
    const endpoint = $('#lab-ai-endpoint').value.trim();
    if (endpoint && !/^https?:\/\//i.test(endpoint)) return toast('接口地址需以 http(s) 开头', 'err');
    state.ai = {
      endpoint,
      key: $('#lab-ai-key').value.trim(),
      model: $('#lab-ai-model').value.trim()
    };
    try { localStorage.setItem(AI_KEY, JSON.stringify(state.ai)); } catch (_) {}
    $('#lab-dialog').close();
    updateAI();
    toast(endpoint ? 'AI 接口已保存' : '已清空接口，使用演示候选');
  }

  function demoAI() {
    if (!state.media) return toast('请先载入影像', 'err');
    triggerScan(700);
    const id = state.dets.length ? Math.max(...state.dets.map(d => d.id)) + 1 : 1;
    const cx = state.media.width * .54, cy = state.media.height * .48;
    state.dets.push({
      id, polygon: [[cx - 58, cy - 22], [cx + 58, cy - 26], [cx + 61, cy + 18], [cx - 55, cy + 22]],
      label: 'vehicle', score: .74, tile: 4, origin: 'ai'
    });
    state.selected = id;
    renderList();
    renderInspector();
    draw();
    bumpCount();
    toast('演示候选已加入；填写接口后会调用你的服务');
  }

  async function runAI() {
    if (!state.media) return toast('请先载入影像', 'err');
    if (!aiReady()) { openAI(); toast('先填写 AI 接口；也可以直接查看演示候选', 'err'); return; }
    triggerScan(1200);
    const c = $('#lab-canvas');
    const fx = document.createElement('canvas');
    fx.width = state.media.width; fx.height = state.media.height;
    const ctx = fx.getContext('2d');
    ctx.drawImage(state.media.img, 0, 0, fx.width, fx.height);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
      if (state.ai.key) headers.Authorization = 'Bearer ' + state.ai.key;
      const r = await fetch(state.ai.endpoint, {
        method: 'POST', headers, signal: ctrl.signal,
        body: JSON.stringify({
          model: state.ai.model || undefined,
          prompt: $('#lab-prompt').value || 'vehicle',
          mode: 'roi',
          image: { data_url: fx.toDataURL('image/jpeg', .86), width: fx.width, height: fx.height },
          roi: null, point: null
        })
      });
      const text = await r.text();
      const data = text ? JSON.parse(text) : null;
      if (!r.ok) throw new Error((data && data.error && data.error.message) || 'HTTP ' + r.status);
      const cand = data && data.candidates && data.candidates[0];
      if (!cand || !Array.isArray(cand.polygon)) throw new Error('响应缺少 candidates[0].polygon');
      const id = state.dets.length ? Math.max(...state.dets.map(d => d.id)) + 1 : 1;
      state.dets.push({ id, polygon: cand.polygon, label: cand.label || 'vehicle', score: cand.quality || .8, tile: 0, origin: 'ai' });
      state.selected = id;
      renderList(); renderInspector(); draw(); bumpCount();
      toast('AI 返回 1 个候选，已加入标注');
    } catch (err) {
      toast(err.name === 'AbortError' ? 'AI 接口超时' : 'AI 调用失败：' + err.message, 'err');
    } finally {
      clearTimeout(timer);
    }
  }

  function exportJSON() {
    const data = {
      contract: 'vehicle-annotation-set/1.0',
      media: { name: state.media && state.media.name, width: state.media && state.media.width, height: state.media && state.media.height },
      detections: state.dets
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'vector-detect.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 800);
    toast('已导出 JSON');
  }

  function bindCanvas() {
    const c = $('#lab-canvas');
    c.addEventListener('wheel', ev => {
      ev.preventDefault();
      if (!state.media) return;
      const r = c.getBoundingClientRect();
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      const ns = Math.max(.1, Math.min(5, state.view.s * (ev.deltaY < 0 ? 1.1 : .9)));
      const k = ns / state.view.s;
      state.view.ox = x - (x - state.view.ox) * k;
      state.view.oy = y - (y - state.view.oy) * k;
      state.view.s = ns;
      $('#lab-zoom').textContent = Math.round(ns * 100) + '%';
      draw();
    }, { passive: false });

    c.addEventListener('pointerdown', ev => {
      if (!state.media) return;
      const r = c.getBoundingClientRect();
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      if (ev.button === 1 || ev.button === 2 || state.space) {
        state.dragging = { x, y, ox: state.view.ox, oy: state.view.oy };
        c.setPointerCapture(ev.pointerId);
        return;
      }
      const d = hit(x, y);
      select(d ? d.id : null);
    });
    c.addEventListener('contextmenu', ev => ev.preventDefault());
    c.addEventListener('pointermove', ev => {
      const r = c.getBoundingClientRect();
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      $('#lab-coord').textContent = state.media ? `${((x - state.view.ox) / state.view.s).toFixed(0)} · ${((y - state.view.oy) / state.view.s).toFixed(0)}` : 'x — · y —';
      if (!state.dragging) return;
      state.view.ox = state.dragging.ox + (x - state.dragging.x);
      state.view.oy = state.dragging.oy + (y - state.dragging.y);
      draw();
    });
    c.addEventListener('pointerup', () => { state.dragging = null; });
    c.addEventListener('pointercancel', () => { state.dragging = null; });
    window.addEventListener('resize', () => { fit(); draw(); });
  }

  function bindKeys() {
    window.addEventListener('keydown', ev => {
      const tag = ev.target && ev.target.tagName;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      if (ev.code === 'Space') { state.space = true; ev.preventDefault(); return; }
      if (ev.key === 'Escape') { select(null); return; }
      if (ev.key === 'Delete' || ev.key === 'Backspace') { if (state.selected) { ev.preventDefault(); deleteSelected(); } }
      if (ev.key === 'f' || ev.key === 'F') { fit(); draw(); }
      if (ev.key === '1') {
        if (!state.media) return;
        state.view.s = 1;
        state.view.ox = ($('#lab-canvas').clientWidth - state.media.width) / 2;
        state.view.oy = ($('#lab-canvas').clientHeight - state.media.height) / 2;
        $('#lab-zoom').textContent = '100%';
        draw();
      }
    });
    window.addEventListener('keyup', ev => { if (ev.code === 'Space') state.space = false; });
  }

  function loadFile(file) {
    if (!file) return;
    state.dets = [];
    state.selected = null;
    loadImage(URL.createObjectURL(file), file.name);
    renderList();
    renderInspector();
    $('#lab-status').textContent = '待检测';
  }

  function bindCursor() {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    const dot = $('#cursor-dot');
    const ring = $('#cursor-ring');
    if (!dot || !ring) return;
    let mx = innerWidth / 2, my = innerHeight / 2, rx = mx, ry = my;
    document.addEventListener('pointermove', ev => {
      mx = ev.clientX; my = ev.clientY;
      dot.style.transform = `translate(${mx}px, ${my}px) translate(-50%,-50%)`;
    });
    const loop = () => {
      rx += (mx - rx) * .18; ry += (my - ry) * .18;
      ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%,-50%)`;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    document.addEventListener('pointerover', ev => {
      ring.classList.toggle('hover', !!ev.target.closest('a, button, input, select, textarea, .tl-card, .lab-item'));
    });
  }

  function boot() {
    loadImage('assets/yard.svg', 'yard.svg');
    bindCanvas();
    bindKeys();
    bindCursor();
    document.addEventListener('pointerdown', ev => {
      const button = ev.target.closest('.tl-btn');
      if (!button) return;
      const r = button.getBoundingClientRect();
      const dot = document.createElement('span');
      dot.className = 'ripple';
      dot.style.left = (ev.clientX - r.left) + 'px';
      dot.style.top = (ev.clientY - r.top) + 'px';
      button.appendChild(dot);
      setTimeout(() => dot.remove(), 600);
    });
    updateAI();
    renderList();
    renderInspector();
    setInterval(() => { $('#lab-clock').textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false }); }, 1000);

    $('#lab-sample').addEventListener('click', () => {
      state.dets = clone(SCENE.detections);
      state.selected = null;
      loadImage('assets/yard.svg', 'yard.svg');
      renderList(); renderInspector();
      toast('已载入示例场地平面图');
    });
    $('#lab-detect').addEventListener('click', runDetect);
    $('#lab-clear').addEventListener('click', clearAll);
    $('#lab-export').addEventListener('click', exportJSON);
    $('#lab-fit').addEventListener('click', () => { fit(); draw(); });
    $('#lab-one').addEventListener('click', () => {
      if (!state.media) return;
      state.view.s = 1;
      state.view.ox = ($('#lab-canvas').clientWidth - state.media.width) / 2;
      state.view.oy = ($('#lab-canvas').clientHeight - state.media.height) / 2;
      $('#lab-zoom').textContent = '100%';
      draw();
    });
    $('#lab-file').addEventListener('change', ev => {
      loadFile(ev.target.files[0]);
    });
    const drop = $('#lab-drop');
    ['dragenter', 'dragover'].forEach(type => drop.addEventListener(type, ev => {
      ev.preventDefault();
      drop.classList.add('hot');
    }));
    ['dragleave', 'drop'].forEach(type => drop.addEventListener(type, ev => {
      ev.preventDefault();
      drop.classList.remove('hot');
    }));
    drop.addEventListener('drop', ev => {
      const file = ev.dataTransfer.files && ev.dataTransfer.files[0];
      loadFile(file);
    });
    $('#lab-ai-config').addEventListener('click', openAI);
    $('#lab-ai-run').addEventListener('click', async ev => {
      if (!state.media) return toast('请先载入影像', 'err');
      const btn = ev.currentTarget;
      if (btn.disabled) return;
      const original = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner btn-spin"></span>处理中…';
      try {
        if (aiReady()) await runAI(); else demoAI();
      } finally {
        btn.disabled = false;
        btn.innerHTML = original;
      }
    });
    $('#lab-dialog-close').addEventListener('click', () => $('#lab-dialog').close());
    $('#lab-dialog-cancel').addEventListener('click', () => $('#lab-dialog').close());
    $('#lab-ai-clear').addEventListener('click', () => {
      state.ai = {};
      try { localStorage.removeItem(AI_KEY); } catch (_) {}
      $('#lab-dialog').close();
      updateAI();
      toast('已清除 AI 接口');
    });
    $('#lab-ai-save').addEventListener('click', saveAI);
    $('#lab-dialog').addEventListener('click', ev => { if (ev.target === $('#lab-dialog')) $('#lab-dialog').close(); });
    $('#lab-list').addEventListener('click', ev => {
      const row = ev.target.closest('[data-id]');
      if (row) select(Number(row.dataset.id));
    });
  }

  boot();
})();
