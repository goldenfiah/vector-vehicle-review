/* VECTOR front-end — a fresh implementation for the vehicle review demo. */
(function () {
  'use strict';

  const SCENE = window.TL_SCENE;
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const clone = v => JSON.parse(JSON.stringify(v));
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const nf = n => Number(n).toLocaleString('zh-CN');

  const AUTH_KEY = 'vector.session.v1';
  const state = {
    view: 'project',
    user: null,
    project: null,
    detections: clone(SCENE.detections),
    remote: false,
    task: null,
    versions: clone(SCENE.versions),
    selected: null,
    filter: 'all',
    region: [],
    regionClosed: false,
    statsOpen: false,
    wb: { scale: 1, ox: 0, oy: 0, img: null, dragging: null },
    timer: null,
    taskTimer: null
  };

  const COLORS = {
    pending: '#6f8b80',
    confirmed: '#1f4b43',
    modified: '#c75b36',
    deleted: '#9c4943',
    ai: '#b38a4e'
  };
  const STATE_LABEL = { pending: '待检查', confirmed: '已确认', modified: '已修改', deleted: '已删除' };
  const REASON_COLOR = { '低置信度': 'red', '贴边目标': 'orange', '跨切片': 'muted' };

  /* ------------------------------------------------------------------ auth */
  function readSession() {
    try {
      const raw = localStorage.getItem(AUTH_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !s.exp || s.exp < Date.now()) { localStorage.removeItem(AUTH_KEY); return null; }
      return s;
    } catch (_) { return null; }
  }

  function saveSession(user, project, remember) {
    const data = { user, project, exp: Date.now() + (remember ? 7 : 1) * 864e5 };
    try { localStorage.setItem(AUTH_KEY, JSON.stringify(data)); } catch (_) {}
  }

  async function hydrateRemote(projectId) {
    if (!window.VECTOR_DATA || projectId !== 'yard-a') {
      $('#sync-label').textContent = '本地演示';
      return;
    }
    try {
      const [project, detections, versions] = await Promise.all([
        VECTOR_DATA.project(projectId),
        VECTOR_DATA.detections(projectId),
        VECTOR_DATA.versions(projectId)
      ]);
      state.project = {
        id: project.id,
        name: project.name,
        code: project.code,
        role: project.role,
        contract: project.contract
      };
      state.detections = detections.items.map(d => ({
        id: d.id, polygon: d.polygon, label: d.label, score: Number(d.score),
        tile: d.tile, state: d.state, origin: d.origin, note: d.note || '', reasons: d.reasons || []
      }));
      state.versions = versions.items.slice().reverse().map((v, i) => ({
        id: i === 0 ? 'v0' : 'v' + v.id,
        label: v.label,
        author: v.author,
        time: String(v.created_at || '').replace('T', ' ').slice(0, 16),
        readonly: i === 0,
        count: v.count,
        summary: v.summary || ''
      }));
      state.remote = true;
      $('#sync-label').textContent = 'SQLITE / API';
      $('#rail-project-name').textContent = state.project.name;
      $('#rail-project-code').textContent = state.project.code;
    } catch (err) {
      state.remote = false;
      $('#sync-label').textContent = '本地演示';
    }
  }

  async function enterApp(session) {
    state.user = session.user;
    state.project = session.project;
    $('#auth').hidden = true;
    $('#auth').classList.add('hidden');
    $('#app').hidden = false;
    $('#app').classList.remove('hidden');
    $('#rail-user-name').textContent = state.user;
    $('#rail-user-initial').textContent = state.user.slice(0, 1).toUpperCase();
    $('#command-user').textContent = state.user;
    $('#rail-project-name').textContent = state.project.name;
    $('#rail-project-code').textContent = state.project.code;
    const loader = $('#app-loader');
    if (loader) loader.classList.remove('hidden');
    $('#sync-label').textContent = '同步中…';
    try {
      await hydrateRemote(state.project.id);
    } finally {
      if (loader) loader.classList.add('hidden');
    }
    go('project');
  }

  $('#auth-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const user = $('#auth-user').value.trim();
    const pass = $('#auth-pass').value;
    const projectId = $('#auth-project').value;
    const err = $('#auth-error');
    const form = $('#auth-form');
    const fail = message => {
      err.textContent = message;
      form.classList.remove('shake');
      void form.offsetWidth;
      form.classList.add('shake');
      const field = !user ? $('#auth-user') : $('#auth-pass');
      if (field) { field.classList.add('invalid'); field.focus(); }
    };
    if (!user || !pass) { fail('请填写账号和密码。'); return; }
    if (user === 'blocked') { fail('该账号不在当前项目成员名单中。'); return; }
    err.textContent = '';
    $('#auth-user').classList.remove('invalid');
    $('#auth-pass').classList.remove('invalid');
    const project = projectId === 'yard-b'
      ? { id: 'yard-b', name: '车辆巡查 B 区', code: 'PRJ-V-0272', role: '项目分析员' }
      : { id: 'yard-a', name: '车辆巡查 A 区', code: 'PRJ-V-0271', role: '项目分析员' };
    const session = { user, project };
    saveSession(user, project, $('#auth-remember').checked);
    const restore = setBusy(ev.currentTarget.querySelector('button[type="submit"]'), '正在进入…');
    try {
      await enterApp(session);
    } finally {
      restore();
    }
  });

  ['#auth-user', '#auth-pass'].forEach(sel => {
    const input = $(sel);
    if (input) input.addEventListener('input', () => input.classList.remove('invalid'));
  });

  let syncDepth = 0;
  let syncPrevious = '';
  document.addEventListener('vector:request', ev => {
    const box = document.querySelector('.sync');
    const label = $('#sync-label');
    if (!box || !label) return;
    if (ev.detail && ev.detail.on) {
      if (syncDepth === 0) {
        syncPrevious = label.textContent;
        label.textContent = '同步中…';
        box.classList.add('syncing');
      }
      syncDepth += 1;
    } else {
      syncDepth = Math.max(0, syncDepth - 1);
      if (syncDepth === 0) {
        if (label.textContent === '同步中…') label.textContent = syncPrevious || 'SQLITE / API';
        box.classList.remove('syncing');
      }
    }
  });

  $('#auth-reveal').addEventListener('click', () => {
    const input = $('#auth-pass');
    input.type = input.type === 'password' ? 'text' : 'password';
    $('#auth-reveal').textContent = input.type === 'password' ? '显示' : '隐藏';
  });

  function logout() {
    try { localStorage.removeItem(AUTH_KEY); } catch (_) {}
    location.reload();
  }
  $('#logout').addEventListener('click', logout);
  $('#command-exit').addEventListener('click', logout);

  /* ------------------------------------------------------------------ nav */
  document.addEventListener('click', ev => {
    const nav = ev.target.closest('[data-view]');
    if (nav && !nav.closest('#rail-nav a')) {
      ev.preventDefault();
      go(nav.dataset.view);
      return;
    }
    const act = ev.target.closest('[data-action]');
    if (act) {
      ev.preventDefault();
      const name = act.dataset.action;
      if (name === 'logout') return logout();
      if (name === 'tool-select') return;
      if (name === 'wb-fit') { fitWb(); drawWb(); return; }
      if (name === 'wb-one') {
        const canvas = $('#wb-canvas');
        if (canvas && state.wb.img) {
          state.wb.scale = 1;
          state.wb.ox = (canvas.clientWidth - 1800) / 2;
          state.wb.oy = (canvas.clientHeight - 1200) / 2;
          $('#wb-zoom').textContent = '100%';
          drawWb();
        }
        return;
      }
      if (name === 'select-object') { state.selected = Number(act.dataset.id); renderWbParts(); drawWb(); return; }
      if (name === 'filter') { state.filter = act.dataset.filter; renderWbParts(); return; }
      if (name === 'confirm') return patchSelected('confirmed');
      if (name === 'delete') return patchSelected('deleted');
      if (name === 'add-ai') return addAiBox();
      if (name === 'save-version') return saveVersion();
      if (name === 'go-workbench') { go('workbench'); return; }
      if (name === 'start-task') return startTask();
      if (name === 'cancel-task') return cancelTask();
      if (name === 'retry-task') return startTask();
      if (name === 'export') return exportAs(act.dataset.format);
      if (name === 'clear-region') { state.region = []; state.regionClosed = false; renderStats(); return; }
      if (name === 'close-region') {
        if (state.region.length > 2) { state.regionClosed = true; state.statsOpen = true; renderStats(); }
        return;
      }
      if (name === 'focus-object') { state.selected = Number(act.dataset.id); go('workbench'); return; }
      if (name === 'guide-jump') { const el = document.getElementById(act.dataset.target); if (el) el.scrollIntoView({ behavior: 'smooth' }); return; }
    }
  });

  function go(view) {
    state.view = view;
    $$('#rail-nav button, #rail-nav a').forEach(x => x.classList.toggle('active', x.dataset.view === view));
    const labels = { project: '项目总览', task: '检测任务', workbench: '复核台', review: '疑难队列', stats: '区域计数', history: '修订档案', export: '报告输出', guide: '使用说明' };
    $('#crumb').textContent = labels[view] || 'VECTOR';
    render();
    scrollRailToActive();
    $('#view-root').scrollTop = 0;
  }

  function scrollRailToActive() {
    const nav = $('#rail-nav');
    const active = nav && nav.querySelector('.active');
    if (!nav || !active) return;
    if (innerWidth > 820) { nav.scrollLeft = 0; return; }
    nav.scrollLeft = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
  }

  function render() {
    const root = $('#view-root');
    const map = {
      project: viewProject, task: viewTask, workbench: viewWorkbench, review: viewReview,
      stats: viewStats, history: viewHistory, export: viewExport, guide: viewGuide
    };
    root.innerHTML = (map[state.view] || viewProject)();
    root.classList.remove('view-in');
    void root.offsetWidth;
    root.classList.add('view-in');
    if (state.view === 'workbench') requestAnimationFrame(mountWb);
    if (state.view === 'stats') requestAnimationFrame(mountStats);
    if (state.view === 'task') requestAnimationFrame(renderTask);
    requestAnimationFrame(() => {
      moveRailInk();
      animateCounts(root);
      observeReveals(root);
    });
  }

  /* ------------------------------------------------------------------ shared */
  function pageHead(kicker, title, aside, meta) {
    return `<header class="page-head">
      <div>
        <p class="eyebrow">${esc(kicker)}</p>
        <h1>${title}</h1>
        <div class="page-meta">${(meta || []).map(m => `<span>${esc(m)}</span>`).join('')}</div>
      </div>
      <p class="page-aside">${aside}</p>
    </header>`;
  }

  function toast(message, kind) {
    const host = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast' + (kind === 'err' ? ' err' : '');
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(4px)'; }, 2600);
    setTimeout(() => el.remove(), 3100);
  }

  function setBusy(button, label) {
    if (!button || button.dataset.busy === '1') return () => {};
    const original = button.innerHTML;
    button.dataset.busy = '1';
    button.disabled = true;
    button.classList.add('is-busy');
    button.innerHTML = '<span class="spinner btn-spin"></span>' + (label || '处理中…');
    return () => {
      button.disabled = false;
      button.classList.remove('is-busy');
      button.innerHTML = original;
      delete button.dataset.busy;
    };
  }

  function feedbackRipple(ev) {
    const button = ev.target.closest('.tl-btn');
    if (!button) return;
    const r = button.getBoundingClientRect();
    const dot = document.createElement('span');
    dot.className = 'ripple';
    dot.style.left = (ev.clientX - r.left) + 'px';
    dot.style.top = (ev.clientY - r.top) + 'px';
    button.appendChild(dot);
    setTimeout(() => dot.remove(), 600);
  }
  document.addEventListener('pointerdown', feedbackRipple);

  function moveRailInk() {
    const nav = $('#rail-nav');
    const ink = $('#rail-ink');
    if (!nav || !ink) return;
    const active = nav.querySelector('.active');
    if (!active) return;
    ink.style.height = active.offsetHeight + 'px';
    ink.style.transform = 'translateY(' + active.offsetTop + 'px)';
  }

  function animateCounts(root) {
    if (!root) return;
    root.querySelectorAll('.metric b, [data-count]').forEach(el => {
      const raw = (el.textContent || '').trim();
      if (!/^\d+$/.test(raw)) return;
      const target = Number(raw);
      if (!target) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      el.textContent = '0';
      const start = performance.now();
      const duration = 480 + Math.min(target, 380);
      const step = now => {
        const t = Math.min(1, (now - start) / duration);
        el.textContent = String(Math.round(target * (1 - Math.pow(1 - t, 3))));
        if (t < 1) requestAnimationFrame(step);
        else el.textContent = raw;
      };
      requestAnimationFrame(step);
    });
  }

  function flash(el) {
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  function duplicateTicker() {
    const flow = $('#ticker-flow');
    if (!flow || flow.dataset.cloned) return;
    flow.innerHTML += flow.innerHTML;
    flow.dataset.cloned = '1';
  }

  function bootSequence() {
    const boot = $('#boot');
    if (!boot) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { boot.remove(); return; }
    try {
      if (sessionStorage.getItem('vector.bootSeen')) { boot.remove(); return; }
      sessionStorage.setItem('vector.bootSeen', '1');
    } catch (_) {}
    const index = $('#boot-index');
    const line = $('#boot-line');
    const status = $('#boot-status');
    let n = 0, finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      index.textContent = '05';
      line.style.width = '100%';
      status.textContent = 'SYSTEM READY';
      setTimeout(() => {
        boot.classList.add('done');
        setTimeout(() => boot.remove(), 760);
      }, 260);
    };
    $('#boot-skip').addEventListener('click', finish);
    const timer = setInterval(() => {
      n = Math.min(5, n + 1);
      index.textContent = String(n).padStart(2, '0');
      line.style.width = (n / 5 * 100) + '%';
      status.textContent = n < 3 ? 'LOADING YARD RECORDS' : n < 5 ? 'CHECKING FIELD NOTES' : 'READY';
      if (n >= 5) finish();
    }, 120);
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
      ring.classList.toggle('hover', !!ev.target.closest('a, button, input, select, textarea, .tl-card, .metric'));
    });
  }

  function bindMagnetic() {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    let current = null;
    document.addEventListener('pointermove', ev => {
      const btn = ev.target.closest('.tl-btn');
      if (btn !== current) {
        if (current) current.style.transform = '';
        current = btn;
      }
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const dx = (ev.clientX - (r.left + r.width / 2)) * .1;
      const dy = (ev.clientY - (r.top + r.height / 2)) * .1;
      btn.style.transform = `translate(${dx}px, ${dy}px)`;
    });
  }

  let revealObserver = null;
  function observeReveals(root) {
    if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!revealObserver) {
      revealObserver = new IntersectionObserver(entries => {
        entries.forEach(e => {
          if (e.isIntersecting) { e.target.classList.add('in'); revealObserver.unobserve(e.target); }
        });
      }, { threshold: .12 });
    }
    root.querySelectorAll('.manual-section, .queue-card, .version, .export-option, .region-side .tl-card').forEach(el => {
      if (el.classList.contains('scroll-reveal')) return;
      el.classList.add('scroll-reveal');
      revealObserver.observe(el);
    });
  }

  function counts() {
    const c = { total: state.detections.length, pending: 0, confirmed: 0, modified: 0, deleted: 0 };
    state.detections.forEach(d => { c[d.state] = (c[d.state] || 0) + 1; });
    c.valid = c.confirmed + c.modified + c.pending;
    return c;
  }

  /* ------------------------------------------------------------------ project */
  function viewProject() {
    const c = counts();
    const reviewed = c.confirmed + c.modified;
    return `${pageHead('PROJECT / 01', '项目总览<br><em>车辆巡查 A 区</em>', '当前项目的影像、任务、复核状态与下一步。这里只做入口和判断，不在总览里改框。', ['PRJ-V-0271', 'ROLE / 项目分析员', 'CONTRACT / 0.2'])}
    <div class="metric-grid">
      <div class="metric"><span>影像 / IMAGE</span><b>${SCENE.project.width}×${SCENE.project.height}</b><small>${SCENE.project.image.split('/').pop()} · RGB</small></div>
      <div class="metric"><span>模型候选 / CANDIDATES</span><b>${c.total}</b><small>${SCENE.project.tiles} 个切片 · NMS 0.10</small></div>
      <div class="metric dark"><span>已复核 / REVIEWED</span><b>${reviewed}</b><small>${c.pending} 个仍在队列中</small></div>
      <div class="metric accent"><span>结果版本 / VERSION</span><b>${state.versions.length}</b><small>最新 ${esc(state.versions[state.versions.length - 1].id)}</small></div>
    </div>
    <div class="split">
      <section class="tl-card">
        <div class="card-top"><h2>项目记录</h2><span class="tag green">受控项目</span></div>
        <dl class="kv">
          <dt>项目编号</dt><dd>${esc(SCENE.project.code)}</dd>
          <dt>分析员</dt><dd>${esc(state.user)}</dd>
          <dt>影像文件</dt><dd>${esc(SCENE.project.image.split('/').pop())}</dd>
          <dt>影像尺寸</dt><dd>${SCENE.project.width} × ${SCENE.project.height}</dd>
          <dt>SHA-256</dt><dd>${esc(SCENE.project.checksum.slice(0, 16))}…</dd>
          <dt>检测模型</dt><dd>${esc(SCENE.project.model)}</dd>
        </dl>
        <div class="rule"></div>
        <div class="card-top"><h3>权限边界</h3><span class="mono dim">SERVER CHECKED</span></div>
        <div class="list">
          ${['影像、瓦片、任务与结果读取', '修订保存与版本切换', '区域计数与报告下载', '跨项目访问被拒绝'].map((t, i) => `<div class="list-row"><span class="idx">0${i + 1}</span><b>${t}</b><span class="tag green">✓</span></div>`).join('')}
        </div>
      </section>
      <section class="tl-card dark">
        <div class="card-top"><h2>下一步</h2><span class="tag orange">NEXT</span></div>
        <p class="card-note">影像接入统一在「智能检测」完成；演示项目已经载入一张园区平面图，可直接创建任务并在复核台检查。</p>
        <div class="rule" style="background:rgba(251,247,238,.18)"></div>
        <div class="list">
          <div class="list-row" style="border-color:rgba(251,247,238,.15)"><span class="idx">A</span><b>创建检测任务</b><a class="tl-btn small" href="#" data-view="task">前往 →</a></div>
          <div class="list-row" style="border-color:rgba(251,247,238,.15)"><span class="idx">B</span><b>检查 ${c.pending} 个待确认目标</b><a class="tl-btn small" href="#" data-view="review">队列 →</a></div>
          <div class="list-row" style="border-color:rgba(251,247,238,.15)"><span class="idx">C</span><b>导出当前版本</b><a class="tl-btn small" href="#" data-view="export">报告 →</a></div>
        </div>
      </section>
    </div>
    <div class="split equal" style="margin-top:22px">
      <section class="tl-card">
        <div class="card-top"><h3>最近记录</h3><a class="mono dim" href="#" data-view="history">查看档案 →</a></div>
        <div class="version-list">
          ${state.versions.slice(-3).reverse().map(v => `<div class="version"><span class="vid">${esc(v.id)}</span><div><b>${esc(v.label)}</b><small>${esc(v.author)} · ${esc(v.time)}</small></div><span class="tag ${v.readonly ? 'muted' : 'green'}">${v.readonly ? '只读' : '人工'}</span></div>`).join('')}
        </div>
      </section>
      <section class="tl-card">
        <div class="card-top"><h3>操作提示</h3><span class="tag orange">SHORTCUT</span></div>
        <div class="list">
          <div class="list-row"><span class="idx">01</span><b>复核台</b><span class="mono dim">Delete / Ctrl+Z</span></div>
          <div class="list-row"><span class="idx">02</span><b>智能检测</b><span class="mono dim">Space / F / 1</span></div>
          <div class="list-row"><span class="idx">03</span><b>完整说明</b><a class="mono dim" href="#" data-view="guide">09 使用说明 →</a></div>
        </div>
      </section>
    </div>`;
  }

  /* ------------------------------------------------------------------ task */
  function viewTask() {
    return `${pageHead('TASK / 02', '检测任务<br><em>把整幅图拆成可核对的切片</em>', '异步推理按切片推进；临时候选和最终数量分开显示，合并完成才发布最终值。', ['TASK #T-0271', '9 TILES', 'MODEL / YOLOV8L-OBB'])}
    <div class="task-layout">
      <section class="tl-card">
        <div class="card-top"><h2>任务进度</h2><span class="tag" id="task-state">未创建</span></div>
        <div class="metric-grid" style="grid-template-columns:repeat(3,1fr);margin-top:0">
          <div class="metric" style="min-height:90px"><span>已完成切片</span><b id="task-tiles">0/9</b><small>逐片写入</small></div>
          <div class="metric" style="min-height:90px"><span>临时候选</span><b id="task-temp">—</b><small>合并前</small></div>
          <div class="metric" style="min-height:90px"><span>最终数量</span><b id="task-final">—</b><small>合并后发布</small></div>
        </div>
        <div class="progress" style="margin-top:18px"><i id="task-progress"></i></div>
        <div class="task-bar">
          <button class="tl-btn solid" id="btn-task-start" data-action="start-task">开始检测 →</button>
          <button class="tl-btn" id="btn-task-cancel" data-action="cancel-task" disabled>取消</button>
          <button class="tl-btn" id="btn-task-retry" data-action="retry-task" disabled>重试</button>
          <span class="spacer"></span>
          <button class="tl-btn" id="btn-task-go" data-action="go-workbench" disabled>进入复核台 →</button>
        </div>
        <div class="task-log" id="task-log">等待创建任务…</div>
      </section>
      <section class="tl-card">
        <div class="card-top"><h3>切片地图</h3><span class="tag muted">1024 / 512</span></div>
        <div class="slice-grid" id="slice-grid">
          ${SCENE.tiles.map(t => `<div class="slice" data-slice="${t.id}"><span>T${t.id}</span><span>WAIT</span></div>`).join('')}
        </div>
        <div class="rule"></div>
        <p class="card-note">取消在可终止边界生效；重试会重新计算整次尝试，不覆盖上一轮最终数量。</p>
      </section>
    </div>`;
  }

  function renderTask() {
    if (!$('#slice-grid')) return;
    const t = state.task;
    const total = SCENE.tiles.length;
    const done = t ? t.done : 0;
    const stateEl = $('#task-state');
    if (stateEl) {
      stateEl.textContent = !t ? '未创建' : t.status === 'done' ? '已完成' : t.status === 'cancelled' ? '已取消' : '运行中';
      stateEl.className = 'tag ' + (!t ? '' : t.status === 'done' ? 'green' : t.status === 'cancelled' ? 'red' : 'orange');
    }
    $('#task-tiles').textContent = done + '/' + total;
    $('#task-temp').textContent = t && t.temp != null ? t.temp : '—';
    $('#task-final').textContent = t && t.final != null ? t.final : '—';
    $('#task-progress').style.width = (done / total * 100) + '%';
    $$('#slice-grid .slice').forEach((el, i) => {
      el.className = 'slice' + (t && i < done ? ' done' : t && i === done && t.status === 'running' ? ' now' : '');
      const last = el.lastElementChild;
      if (last) last.textContent = t && i < done ? 'OK' : t && i === done && t.status === 'running' ? 'RUN' : 'WAIT';
    });
    const startBtn = $('#btn-task-start');
    if (startBtn) {
      const running = !!t && t.status === 'running';
      startBtn.disabled = running;
      startBtn.innerHTML = running ? '<span class="spinner btn-spin"></span>检测中…' : '开始检测 →';
    }
    if ($('#btn-task-cancel')) $('#btn-task-cancel').disabled = !t || t.status !== 'running';
    if ($('#btn-task-retry')) $('#btn-task-retry').disabled = !t || t.status === 'running';
    if ($('#btn-task-go')) $('#btn-task-go').disabled = !t || t.status !== 'done';
    if (t) {
      $('#task-log').innerHTML = `<div><b>${t.id}</b> · ${t.status === 'done' ? '已完成' : t.status === 'cancelled' ? '已取消' : '运行中'} · 第 ${t.attempt} 次尝试</div>
        <div>已完成 ${done}/${total} 片，临时候选 ${t.temp || 0}</div>
        <div>${t.final != null ? '合并后发布最终数量 ' + t.final : '最终数量等待合并完成'}</div>`;
    }
  }

  function startTask() {
    if (state.taskTimer) clearInterval(state.taskTimer);
    if (state.task && state.task.status === 'running') return;
    state.task = { id: 'T-0271', status: 'running', done: 0, temp: 0, final: null, attempt: state.task ? state.task.attempt + 1 : 1 };
    renderTask();
    state.taskTimer = setInterval(() => {
      const t = state.task;
      if (!t || t.status !== 'running') return;
      t.done += 1;
      t.temp += 4 + Math.floor(Math.random() * 7);
      if (t.done >= SCENE.tiles.length) {
        t.done = SCENE.tiles.length;
        t.status = 'done';
        t.final = state.detections.filter(d => d.state !== 'deleted').length;
        clearInterval(state.taskTimer);
        state.taskTimer = null;
        toast('检测完成，最终数量已发布');
      }
      renderTask();
    }, 380);
  }

  function cancelTask() {
    if (!state.task || state.task.status !== 'running') return;
    state.task.status = 'cancelled';
    clearInterval(state.taskTimer);
    state.taskTimer = null;
    renderTask();
    toast('已取消，保留已完成切片');
  }

  /* ------------------------------------------------------------------ workbench */
  function filteredDets() {
    if (state.filter === 'all') return state.detections;
    return state.detections.filter(d => d.state === state.filter);
  }

  function viewWorkbench() {
    const items = filteredDets();
    const sel = state.detections.find(d => d.id === state.selected);
    return `<div class="review-shell">
      <aside class="object-pane">
        <div class="pane-head"><b>目标列表</b><span class="mono dim">${state.detections.filter(d => d.state !== 'deleted').length} / ${state.detections.length}</span></div>
        <div class="pane-tools">
          ${[['all', '全部'], ['pending', '待检查'], ['confirmed', '已确认'], ['modified', '已修改'], ['deleted', '已删除']].map(([k, v]) => `<button class="${state.filter === k ? 'on' : ''}" data-action="filter" data-filter="${k}">${v}</button>`).join('')}
        </div>
        <div class="object-list" id="object-list">
          ${items.length ? items.map(d => `<div class="object-row ${state.selected === d.id ? 'active' : ''}" data-action="select-object" data-id="${d.id}">
            <span class="object-dot" style="background:${COLORS[d.state]}"></span>
            <b>#${String(d.id).padStart(2, '0')}</b>
            <span>${esc(d.label)} <i style="color:var(--muted);font-style:normal">${STATE_LABEL[d.state]}</i></span>
            <i>${d.score.toFixed(2)}</i>
          </div>`).join('') : '<div class="empty">当前筛选下没有目标</div>'}
        </div>
      </aside>
      <section class="canvas-column">
        <div class="canvas-bar">
          <button class="tl-btn on" data-action="tool-select">选择</button>
          <button class="tl-btn" data-action="add-ai">AI 补框</button>
          <span class="spacer"></span>
          <button class="tl-btn" data-action="wb-fit">适应</button>
          <button class="tl-btn" data-action="wb-one">1:1</button>
          <button class="tl-btn" data-action="save-version">保存修订 →</button>
        </div>
        <div class="canvas-stage">
          <canvas id="wb-canvas"></canvas>
          <div class="canvas-hud"><b>YARD / V-17</b><span>1800 × 1200 · ROTATED BOX</span><span id="wb-count">${state.detections.length} OBJECTS</span></div>
          <div class="canvas-hint">滚轮缩放 · 右键 / 中键拖动平移 · 点击目标</div>
          <div class="canvas-zoom" id="wb-zoom">—</div>
        </div>
      </section>
      <aside class="inspector-pane">
        <div class="pane-head"><b>目标详情</b><span class="mono dim" id="sel-id">${sel ? '#' + sel.id : '—'}</span></div>
        <div class="inspector-body" id="wb-inspector">${renderInspector(sel)}</div>
      </aside>
    </div>`;
  }

  function renderInspector(d) {
    if (!d) return `<div class="inspector-empty"><b>未选择目标</b>在画布或列表中选择一个框，查看中心、宽高、角度与四角坐标。</div>`;
    const c = boxCenter(d.polygon);
    const b = boxSize(d.polygon);
    return `<div class="card-kicker">TARGET / ${esc(d.origin)}</div>
      <h2 style="margin:6px 0 12px">${esc(d.label)} <span class="tag ${d.state === 'confirmed' ? 'green' : d.state === 'deleted' ? 'red' : 'orange'}">${STATE_LABEL[d.state]}</span></h2>
      <dl class="kv">
        <dt>来源</dt><dd>${d.origin === 'model' ? '模型' : '人工'}</dd>
        <dt>切片</dt><dd>T${d.tile}</dd>
        <dt>置信度</dt><dd>${d.score.toFixed(3)}</dd>
        <dt>中心</dt><dd>${c[0].toFixed(1)}, ${c[1].toFixed(1)}</dd>
        <dt>宽 × 高</dt><dd>${b[0].toFixed(1)} × ${b[1].toFixed(1)}</dd>
        <dt>四角</dt><dd>${d.polygon.length} 点</dd>
      </dl>
      <div class="rule"></div>
      <div class="card-kicker">POLYGON / 原图像素</div>
      <div class="mono" style="font-size:9px;line-height:1.8;color:var(--muted);margin-top:8px">${d.polygon.map(p => `[${p[0].toFixed(1)}, ${p[1].toFixed(1)}]`).join('<br>')}</div>
      <div class="inspector-actions">
        <button class="tl-btn small" data-action="confirm">确认选中</button>
        <button class="tl-btn small danger" data-action="delete">删除</button>
      </div>`;
  }

  function mountWb() {
    const canvas = $('#wb-canvas');
    if (!canvas) return;
    const img = new Image();
    img.onload = () => {
      state.wb.img = img;
      fitWb();
      bindWb(canvas);
      drawWb();
    };
    img.src = 'assets/yard.svg';
  }

  function fitWb() {
    const canvas = $('#wb-canvas');
    if (!canvas || !state.wb.img) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const s = Math.min(w / 1800, h / 1200) * .9;
    state.wb.scale = s;
    state.wb.ox = (w - 1800 * s) / 2;
    state.wb.oy = (h - 1200 * s) / 2;
    state.wb.dpr = dpr;
    $('#wb-zoom').textContent = Math.round(s * 100) + '%';
  }

  function drawWb() {
    const canvas = $('#wb-canvas');
    if (!canvas || !state.wb.img) return;
    const ctx = canvas.getContext('2d');
    const dpr = state.wb.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    const { scale, ox, oy } = state.wb;
    ctx.drawImage(state.wb.img, ox, oy, 1800 * scale, 1200 * scale);
    ctx.strokeStyle = 'rgba(200,91,53,.65)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox, oy, 1800 * scale, 1200 * scale);
    for (const d of state.detections) {
      if (d.state === 'deleted') continue;
      const pts = d.polygon.map(p => [ox + p[0] * scale, oy + p[1] * scale]);
      ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
      ctx.closePath();
      const selected = d.id === state.selected;
      ctx.lineWidth = selected ? 2.4 : 1.2;
      ctx.strokeStyle = selected ? '#c75b36' : (COLORS[d.state] || '#1f4b43');
      ctx.stroke();
      if (selected) {
        ctx.fillStyle = 'rgba(199,91,54,.16)';
        ctx.fill();
      }
      ctx.font = '9px "IBM Plex Mono", monospace';
      ctx.fillStyle = '#fbf7ee';
      const label = '#' + d.id;
      const lw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(12,25,22,.82)';
      ctx.fillRect(pts[0][0], pts[0][1] - 13, lw + 8, 13);
      ctx.fillStyle = '#fbf7ee';
      ctx.fillText(label, pts[0][0] + 4, pts[0][1] - 3);
    }
    if (state.region.length && state.statsOpen) {
      ctx.beginPath();
      state.region.forEach((p, i) => {
        const x = ox + p[0] * scale, y = oy + p[1] * scale;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      if (state.regionClosed) ctx.closePath();
      ctx.strokeStyle = '#b38a4e';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      if (state.regionClosed) {
        ctx.fillStyle = 'rgba(179,138,78,.16)';
        ctx.fill();
      }
    }
  }

  function bindWb(canvas) {
    canvas.addEventListener('wheel', ev => {
      ev.preventDefault();
      const r = canvas.getBoundingClientRect();
      const sx = ev.clientX - r.left, sy = ev.clientY - r.top;
      const factor = ev.deltaY < 0 ? 1.1 : .9;
      const ns = Math.max(.15, Math.min(4, state.wb.scale * factor));
      const k = ns / state.wb.scale;
      state.wb.ox = sx - (sx - state.wb.ox) * k;
      state.wb.oy = sy - (sy - state.wb.oy) * k;
      state.wb.scale = ns;
      $('#wb-zoom').textContent = Math.round(ns * 100) + '%';
      drawWb();
    }, { passive: false });

    canvas.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      const r = canvas.getBoundingClientRect();
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      if (ev.button === 1 || ev.button === 2) {
        state.wb.dragging = { type: 'pan', x, y, ox: state.wb.ox, oy: state.wb.oy };
        canvas.setPointerCapture(ev.pointerId);
        return;
      }
      const hit = state.detections.slice().reverse().find(d => d.state !== 'deleted' && pointInPoly(x, y, d.polygon, state.wb));
      state.selected = hit ? hit.id : null;
      renderWbParts();
      drawWb();
    });
    canvas.addEventListener('contextmenu', ev => ev.preventDefault());
    canvas.addEventListener('pointermove', ev => {
      const drag = state.wb.dragging;
      if (!drag) return;
      const r = canvas.getBoundingClientRect();
      state.wb.ox = drag.ox + (ev.clientX - r.left - drag.x);
      state.wb.oy = drag.oy + (ev.clientY - r.top - drag.y);
      drawWb();
    });
    canvas.addEventListener('pointerup', () => { state.wb.dragging = null; });
    canvas.addEventListener('pointercancel', () => { state.wb.dragging = null; });
  }

  function hitBox(d, x, y) {
    const { scale, ox, oy } = state.wb;
    const pts = d.polygon.map(p => [ox + p[0] * scale, oy + p[1] * scale]);
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  function pointInPoly(x, y, poly, vp) {
    const { scale, ox, oy } = vp;
    const pts = poly.map(p => [ox + p[0] * scale, oy + p[1] * scale]);
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  function renderWbParts() {
    const sel = state.detections.find(d => d.id === state.selected);
    const list = $('#object-list');
    if (list) {
      const items = filteredDets();
      list.innerHTML = items.length ? items.map(d => `<div class="object-row ${state.selected === d.id ? 'active' : ''}" data-action="select-object" data-id="${d.id}">
        <span class="object-dot" style="background:${COLORS[d.state]}"></span>
        <b>#${String(d.id).padStart(2, '0')}</b>
        <span>${esc(d.label)} <i style="color:var(--muted);font-style:normal">${STATE_LABEL[d.state]}</i></span>
        <i>${d.score.toFixed(2)}</i>
      </div>`).join('') : '<div class="empty">当前筛选下没有目标</div>';
    }
    const ins = $('#wb-inspector');
    if (ins) { ins.innerHTML = renderInspector(sel); flash(ins); }
    const sid = $('#sel-id');
    if (sid) sid.textContent = sel ? '#' + sel.id : '—';
    $$('.pane-tools button').forEach(b => b.classList.toggle('on', b.dataset.filter === state.filter));
  }

  async function patchSelected(next) {
    const d = state.detections.find(x => x.id === state.selected);
    if (!d) { toast('请先选择一个目标', 'err'); return; }
    const previous = d.state;
    d.state = next;
    renderWbParts();
    drawWb();
    if (state.remote) {
      toast('正在同步到 SQLite…');
      try {
        await VECTOR_DATA.patch(d.id, { state: next });
      } catch (err) {
        d.state = previous;
        renderWbParts();
        drawWb();
        toast('后端同步失败：' + err.message, 'err');
        return;
      }
    }
    toast(next === 'confirmed' ? '已确认 #' + d.id : '已删除 #' + d.id);
  }

  async function addAiBox() {
    const cx = 930 + Math.random() * 180;
    const cy = 520 + Math.random() * 160;
    const polygon = [[cx - 55, cy - 18], [cx + 55, cy - 22], [cx + 58, cy + 16], [cx - 52, cy + 20]];
    if (state.remote) {
      try {
        const saved = await VECTOR_DATA.addDetection('yard-a', { polygon, label: 'car', score: .68, note: 'AI 补框' });
        state.detections.push({
          id: saved.id, polygon: saved.polygon, label: saved.label, score: Number(saved.score),
          tile: saved.tile, state: saved.state, origin: 'ai', note: saved.note, reasons: saved.reasons || []
        });
        state.selected = saved.id;
        renderWbParts();
        drawWb();
        toast('AI 补框已写入 SQLite，保存修订后进入版本');
        return;
      } catch (err) {
        toast('AI 补框后端写入失败，改为本地草稿：' + err.message, 'err');
      }
    }
    const id = Math.max(...state.detections.map(d => d.id)) + 1;
    state.detections.push({
      id, polygon, label: 'car', score: .68, confidence: null, tile: 4,
      state: 'modified', origin: 'ai', note: 'AI 补框', reasons: []
    });
    state.selected = id;
    renderWbParts();
    drawWb();
    toast('AI 补框已加入本地草稿，保存修订后写入版本');
  }

  async function saveVersion() {
    const changed = state.detections.filter(d => d.state !== 'pending').length;
    const summary = `确认 ${state.detections.filter(d => d.state === 'confirmed').length} · 修改 ${state.detections.filter(d => d.state === 'modified').length} · 删除 ${state.detections.filter(d => d.state === 'deleted').length}`;
    const restore = setBusy(document.querySelector('[data-action="save-version"]'), '保存中…');
    try {
    if (state.remote) {
      try {
        const saved = await VECTOR_DATA.saveVersion('yard-a', {
          label: '人工修订', author: state.user || 'analyst', summary
        });
        const versions = await VECTOR_DATA.versions('yard-a');
        state.versions = versions.items.slice().reverse().map((v, i) => ({
          id: i === 0 ? 'v0' : 'v' + v.id,
          label: v.label, author: v.author,
          time: String(v.created_at || '').replace('T', ' ').slice(0, 16),
          readonly: i === 0, count: v.count, summary: v.summary || ''
        }));
        toast('已保存到 SQLite 版本 v' + saved.id + '（' + changed + ' 个已检查目标）');
        return;
      } catch (err) {
        toast('后端保存失败，已保存到本地演示：' + err.message, 'err');
      }
    }
    const v = {
      id: 'v' + state.versions.length,
      label: '人工修订',
      author: state.user || 'analyst',
      time: new Date().toLocaleString('zh-CN', { hour12: false }).slice(0, 16),
      readonly: false,
      count: state.detections.filter(d => d.state !== 'deleted').length,
      summary
    };
    state.versions.push(v);
    toast('已保存为版本 ' + v.id + '（' + changed + ' 个已检查目标）');
    drawWb();
    } finally {
      restore();
    }
  }

  function centerOnSelected() {
    const d = state.detections.find(x => x.id === state.selected);
    if (!d || !state.wb.img) return;
    const c = boxCenter(d.polygon);
    state.wb.ox = $('#wb-canvas').clientWidth / 2 - c[0] * state.wb.scale;
    state.wb.oy = $('#wb-canvas').clientHeight / 2 - c[1] * state.wb.scale;
    drawWb();
  }

  function boxCenter(poly) {
    const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  }

  function boxSize(poly) {
    const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
    return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  }

  /* ------------------------------------------------------------------ review */
  function viewReview() {
    const flagged = state.detections.filter(d => d.reasons && d.reasons.length && d.state !== 'deleted');
    return `${pageHead('QUEUE / 05', '疑难队列<br><em>把不确定的目标集中起来</em>', '按可解释原因排序：低置信度、贴边、跨切片和来源可疑。每条都能回到复核台定位。', ['OPEN / ' + flagged.length, 'SORT / REASON', 'RULE / 中心点'])}
    <div class="queue-grid">
      ${flagged.map(d => `<article class="queue-card">
        <div class="queue-card-top"><h3>#${d.id} · ${esc(d.label)}</h3><span class="tag ${d.reasons.includes('低置信度') ? 'red' : 'orange'}">${d.score.toFixed(2)}</span></div>
        <p>切片 T${d.tile} · ${d.state === 'pending' ? '尚未复核' : STATE_LABEL[d.state]} · ${d.polygon.length} 点旋转框</p>
        <div class="reasons">${d.reasons.map(r => `<span class="tag ${REASON_COLOR[r] || 'muted'}">${r}</span>`).join('')}</div>
        <button class="tl-btn small" data-action="focus-object" data-id="${d.id}">去复核 →</button>
      </article>`).join('') || '<div class="empty"><b>队列已清空</b>当前没有需要人工判断的目标。</div>'}
    </div>`;
  }

  /* ------------------------------------------------------------------ stats */
  function viewStats() {
    return `${pageHead('REGION / 06', '区域计数<br><em>按中心点归属，而不是按重叠</em>', '在图上逐点圈出关注区域，双击闭合。目标中心点落入区域才计数，同一目标只归属一次。', ['TOOL / POLYGON', 'RULE / CENTER-IN', 'VERSION / ' + state.versions[state.versions.length - 1].id])}
    <div class="region-layout">
      <section>
        <div class="region-tools">
          <button class="tl-btn small" data-action="clear-region">清除区域</button>
          <button class="tl-btn small" data-action="close-region">闭合区域</button>
          <span class="mono dim" style="align-self:center;margin-left:6px">点击添加顶点 · 双击闭合</span>
        </div>
        <div class="region-canvas"><canvas id="stats-canvas"></canvas></div>
      </section>
      <aside class="region-side">
        <section class="tl-card">
          <div class="card-top"><h3>区域盘点</h3><span class="tag ${state.regionClosed ? 'green' : 'muted'}">${state.regionClosed ? '已闭合' : '未闭合'}</span></div>
          <div id="region-summary"><div class="empty">尚未圈选区域<br><span class="dim">在左侧点击若干顶点</span></div></div>
          <div class="rule"></div>
          <div class="card-kicker">FULL IMAGE</div>
          <div class="region-count" id="global-count"></div>
        </section>
      </aside>
    </div>`;
  }

  function mountStats() {
    const canvas = $('#stats-canvas');
    if (!canvas) return;
    const img = new Image();
    img.onload = () => {
      state.statsImg = img;
      bindStats(canvas);
      renderStats();
    };
    img.src = 'assets/yard.svg';
  }

  function fitStatsCanvas(canvas) {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    return { w: r.width, h: r.height, dpr };
  }

  function renderStats() {
    const canvas = $('#stats-canvas');
    if (!canvas || !state.statsImg) return;
    const { w, h, dpr } = fitStatsCanvas(canvas);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const s = Math.min(w / 1800, h / 1200) * .94;
    const ox = (w - 1800 * s) / 2, oy = (h - 1200 * s) / 2;
    state.statsView = { s, ox, oy };
    ctx.drawImage(state.statsImg, ox, oy, 1800 * s, 1200 * s);
    ctx.strokeStyle = 'rgba(200,91,53,.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox, oy, 1800 * s, 1200 * s);
    for (const d of state.detections) {
      if (d.state === 'deleted') continue;
      const pts = d.polygon.map(p => [ox + p[0] * s, oy + p[1] * s]);
      ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
      ctx.closePath();
      ctx.strokeStyle = 'rgba(251,247,238,.38)';
      ctx.lineWidth = .8;
      ctx.stroke();
    }
    if (state.region.length) {
      ctx.beginPath();
      state.region.forEach((p, i) => {
        const x = ox + p[0] * s, y = oy + p[1] * s;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      if (state.regionClosed) ctx.closePath();
      ctx.strokeStyle = '#b38a4e';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (state.regionClosed) {
        ctx.fillStyle = 'rgba(179,138,78,.18)';
        ctx.fill();
      }
      state.region.forEach(p => {
        ctx.beginPath();
        ctx.arc(ox + p[0] * s, oy + p[1] * s, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = '#fbf7ee';
        ctx.fill();
      });
    }
    updateRegionCounts();
  }

  function bindStats(canvas) {
    canvas.addEventListener('click', ev => {
      if (state.regionClosed) return;
      const r = canvas.getBoundingClientRect();
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      const v = state.statsView;
      state.region.push([(x - v.ox) / v.s, (y - v.oy) / v.s]);
      renderStats();
    });
    canvas.addEventListener('dblclick', () => {
      if (state.region.length > 2) {
        state.regionClosed = true;
        state.statsOpen = true;
        renderStats();
      }
    });
    canvas.addEventListener('contextmenu', ev => ev.preventDefault());
  }

  function updateRegionCounts() {
    const c = counts();
    const global = $('#global-count');
    if (global) {
      global.innerHTML = Object.entries({ '待检查': c.pending, '已确认': c.confirmed, '已修改': c.modified, '已删除': c.deleted, '当前有效': c.valid, '模型候选': c.total })
        .map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('');
    }
    const summary = $('#region-summary');
    if (!summary) return;
    if (!state.regionClosed) {
      summary.innerHTML = `<div class="empty">${state.region.length ? '继续点击顶点，双击闭合' : '尚未圈选区域<br><span class="dim">在左侧点击若干顶点</span>'}</div>`;
      return;
    }
    const inside = state.detections.filter(d => d.state !== 'deleted' && pointInPolyWorld(boxCenter(d.polygon), state.region));
    const part = { pending: 0, confirmed: 0, modified: 0, deleted: 0 };
    inside.forEach(d => { part[d.state] = (part[d.state] || 0) + 1; });
    summary.innerHTML = `<div class="region-count">
      <span>区域内总数</span><b>${inside.length}</b>
      <span>待检查</span><b>${part.pending || 0}</b>
      <span>已确认</span><b>${part.confirmed || 0}</b>
      <span>已修改</span><b>${part.modified || 0}</b>
      <span>当前有效</span><b>${inside.length}</b>
    </div>`;
  }

  function pointInPolyWorld([x, y], poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  /* ------------------------------------------------------------------ history */
  function viewHistory() {
    return `${pageHead('ARCHIVE / 07', '修订档案<br><em>模型原始结果不可变</em>', '每次保存追加一个版本，记录作者、时间与变更摘要。历史版本只读，恢复操作会生成新记录。', ['v0 / IMMUTABLE', 'APPEND-ONLY', 'CURRENT / ' + state.versions[state.versions.length - 1].id])}
    <div class="split">
      <section>
        <div class="version-list">
          ${state.versions.slice().reverse().map(v => `<div class="version ${v.id === state.versions[state.versions.length - 1].id ? 'on' : ''}">
            <span class="vid">${esc(v.id)}</span>
            <div><b>${esc(v.label)}</b><small>${esc(v.author)} · ${esc(v.time)} · ${v.count} 个有效目标</small></div>
            <div style="display:flex;gap:5px;align-items:center"><span class="tag ${v.readonly ? 'muted' : 'green'}">${v.readonly ? '只读' : '人工'}</span></div>
          </div>`).join('')}
        </div>
      </section>
      <section class="tl-card">
        <div class="card-top"><h3>变更摘要</h3><span class="tag orange">${esc(state.versions[state.versions.length - 1].id)}</span></div>
        <p class="card-note">${esc(state.versions[state.versions.length - 1].summary || '模型原始结果，无人工变更')}</p>
        <div class="rule"></div>
        <div class="region-count">
          <span>确认</span><b>${state.detections.filter(d => d.state === 'confirmed').length}</b>
          <span>修改</span><b>${state.detections.filter(d => d.state === 'modified').length}</b>
          <span>删除</span><b>${state.detections.filter(d => d.state === 'deleted').length}</b>
          <span>当前有效</span><b>${state.detections.filter(d => d.state !== 'deleted').length}</b>
        </div>
        <div class="note cool" style="margin-top:16px">报告导出绑定指定版本，后续修订不会悄悄改变旧报告。</div>
      </section>
    </div>`;
  }

  /* ------------------------------------------------------------------ export */
  function viewExport() {
    return `${pageHead('EXPORT / 08', '报告输出<br><em>导出一个可复核的版本</em>', '导出绑定当前结果版本，包含检测框、复核状态、坐标和请求信息。未保存草稿不进入报告。', ['CSV / JSON / PNG', 'VERSION BOUND', 'READY'])}
    <div class="export-grid">
      <section class="tl-card">
        <div class="card-top"><h2>导出内容</h2><span class="tag green">版本 ${esc(state.versions[state.versions.length - 1].id)}</span></div>
        <div class="export-option"><div><b>检测结果表</b><small>CSV · 框、状态、中心、四角坐标</small></div><button class="tl-btn small" data-action="export" data-format="csv">下载</button></div>
        <div class="export-option"><div><b>标注图</b><small>PNG · 原图像素绘制</small></div><button class="tl-btn small" data-action="export" data-format="png">下载</button></div>
        <div class="export-option"><div><b>分析报告</b><small>JSON · 模型、参数、版本与统计口径</small></div><button class="tl-btn small" data-action="export" data-format="json">下载</button></div>
      </section>
      <section class="tl-card dark">
        <div class="card-top"><h2>报告将包含</h2><span class="tag orange">FIXED</span></div>
        <dl class="kv">
          <dt>项目</dt><dd>${esc(SCENE.project.code)}</dd>
          <dt>影像</dt><dd>${SCENE.project.width} × ${SCENE.project.height}</dd>
          <dt>版本</dt><dd>${esc(state.versions[state.versions.length - 1].id)}</dd>
          <dt>有效目标</dt><dd>${state.detections.filter(d => d.state !== 'deleted').length}</dd>
          <dt>契约</dt><dd>vehicle-detection / 0.2</dd>
        </dl>
        <div class="note" style="margin-top:18px;background:rgba(251,247,238,.08);border-left-color:var(--orange);color:rgba(251,247,238,.8)">导出是快照，不是实时联动。后续修订不会改变已下载的报告。</div>
      </section>
    </div>`;
  }

  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function exportAs(format) {
    const version = state.versions[state.versions.length - 1].id;
    if (format === 'json') {
      const payload = {
        contract: 'vehicle-annotation-set/1.0',
        project: SCENE.project.code,
        version,
        image: { width: 1800, height: 1200, name: 'yard.svg' },
        detections: state.detections.map(d => ({
          id: d.id, polygon: d.polygon, label: d.label, state: d.state,
          origin: d.origin, score: d.score, tile: d.tile, reasons: d.reasons
        }))
      };
      download(`vector-${version}.json`, JSON.stringify(payload, null, 2), 'application/json');
    } else if (format === 'csv') {
      const rows = [['id', 'label', 'state', 'origin', 'score', 'tile', 'polygon']];
      state.detections.forEach(d => rows.push([d.id, d.label, d.state, d.origin, d.score, d.tile, JSON.stringify(d.polygon)]));
      download(`vector-${version}.csv`, rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
    } else {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = 1800; c.height = 1200;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        state.detections.forEach(d => {
          if (d.state === 'deleted') return;
          ctx.beginPath();
          d.polygon.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
          ctx.closePath();
          ctx.strokeStyle = COLORS[d.state] || '#1f4b43';
          ctx.lineWidth = 3;
          ctx.stroke();
        });
        c.toBlob(blob => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `vector-${version}.png`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        });
      };
      img.src = 'assets/yard.svg';
    }
    toast('已生成 ' + format.toUpperCase() + ' 导出');
  }

  /* ------------------------------------------------------------------ guide */
  function viewGuide() {
    return `${pageHead('MANUAL / 09', '使用说明<br><em>九模块 · 一条线</em>', '从登录到报告输出，每个模块做什么、怎么操作、有哪些快捷键。', ['9 MODULES', 'SHORTCUTS', 'AI ACCESS'])}
    <div class="manual-hero" style="margin-top:28px">
      <div>
        <h1 style="font-size:clamp(28px,4vw,44px)">先看流程，再看模块。</h1>
        <p>主流程：登录 → 项目总览 → 检测任务 → 复核台 → 疑难队列 → 区域计数 → 修订档案 → 报告输出。智能检测独立处理图片 / 视频与 AI 辅助。</p>
      </div>
      <nav class="manual-nav">
        ${[['01', '项目总览', 'project'], ['02', '检测任务', 'task'], ['03', '复核台', 'workbench'], ['04', '智能检测', 'detect'], ['05', '疑难队列', 'review'], ['06', '区域计数', 'stats'], ['07', '修订档案', 'history'], ['08', '报告输出', 'export']].map(([n, t]) => `<a href="#" data-action="guide-jump" data-target="m-${n}"><span>${n}</span>${t}</a>`).join('')}
      </nav>
    </div>

    <section class="manual-section" id="m-01">
      <h2><span>01</span>项目总览</h2>
      <p><b>做什么：</b>确认项目、角色、影像和任务状态。这里不直接改框，只做入口与判断。</p>
      <ul>
        <li>查看项目编号、分析员、影像尺寸、SHA-256 和检测模型。</li>
        <li>从「下一步」进入检测任务、疑难队列或报告输出。</li>
        <li>权限边界只做展示；真实系统在服务端逐请求校验。</li>
      </ul>
      <div class="manual-key"><b>快捷键：</b>无专属快捷键；使用 <kbd>Tab</kbd> 在链接与按钮之间移动。</div>
    </section>

    <section class="manual-section" id="m-02">
      <h2><span>02</span>检测任务</h2>
      <p><b>做什么：</b>把整幅影像拆成 9 个切片异步推理，先显示临时进度，合并后再发布最终数量。</p>
      <ul>
        <li>「开始检测」创建任务；切片格子从 WAIT 变为 RUN / OK。</li>
        <li>取消只在可终止边界生效；重试重新计算整次尝试。</li>
        <li>任务完成后可进入复核台。</li>
      </ul>
      <div class="manual-key"><b>快捷键：</b>无专属快捷键；按钮操作。</div>
    </section>

    <section class="manual-section" id="m-03">
      <h2><span>03</span>复核台</h2>
      <p><b>做什么：</b>在原始影像上逐目标确认、修改或删除，并把修改保存为可追溯的版本。</p>
      <ul>
        <li>左侧筛选目标；画布点击选中；右侧查看中心、宽高、角度与四角坐标。</li>
        <li>「确认选中」「删除」写入草稿；「保存修订」追加版本。</li>
        <li>「AI 补框」会加入一个草稿框，需人工确认后再保存。</li>
      </ul>
      <div class="manual-key"><b>快捷键：</b><kbd>Delete</kbd> 删除选中；<kbd>Ctrl+Z</kbd> 撤销最近一次保存前草稿（本演示以版本保存为准）；<kbd>Esc</kbd> 取消选择；滚轮缩放，右键 / 中键拖动平移。</div>
    </section>

    <section class="manual-section" id="m-04">
      <h2><span>04</span>智能检测</h2>
      <p><b>做什么：</b>独立处理图片与视频，检测、画框、AI 辅助框选和导出标注。</p>
      <ul>
        <li>载入图片 / 视频，或使用示例图；右侧显示坐标、属性和 AI 面板。</li>
        <li>检测当前帧；可删除选中框；AI 辅助需要先在「AI 接口」填写服务地址。</li>
        <li>导出的 JSON 绑定当前媒体。</li>
      </ul>
      <div class="manual-key"><b>快捷键：</b><kbd>Space</kbd> + 拖动平移；<kbd>Delete</kbd> 删除选中；<kbd>Esc</kbd> 取消；<kbd>F</kbd> 适应；<kbd>1</kbd> 1:1；<kbd>P</kbd> 播放 / 暂停。</div>
    </section>

    <section class="manual-section" id="m-05">
      <h2><span>05</span>疑难队列</h2>
      <p><b>做什么：</b>集中展示低置信度、贴边、跨切片等需要人工判断的目标。</p>
      <ul>
        <li>每条卡片显示原因、分数、切片和当前状态。</li>
        <li>「去复核」回到复核台并选中该目标。</li>
      </ul>
    </section>

    <section class="manual-section" id="m-06">
      <h2><span>06</span>区域计数</h2>
      <p><b>做什么：</b>在图上圈出关注区域，按目标中心点统计区域内数量。</p>
      <ul>
        <li>逐点单击；双击闭合；可清除后重画。</li>
        <li>右侧显示区域总数、待检查、已确认、已修改和全图口径。</li>
      </ul>
      <div class="manual-key"><b>鼠标：</b>单击添加顶点，双击闭合；区域只统计中心点落入的目标。</div>
    </section>

    <section class="manual-section" id="m-07">
      <h2><span>07</span>修订档案</h2>
      <p><b>做什么：</b>保留每次保存的版本，v0 不可变，后续追加人工版本。</p>
      <ul>
        <li>查看作者、时间、有效目标数和变更摘要。</li>
        <li>历史版本只读；报告导出绑定指定版本。</li>
      </ul>
    </section>

    <section class="manual-section" id="m-08">
      <h2><span>08</span>报告输出</h2>
      <p><b>做什么：</b>把当前版本导出为 CSV、PNG 或 JSON，供复核与归档。</p>
      <ul>
        <li>CSV 含框、状态、中心与四角坐标；JSON 含模型、版本与统计口径。</li>
        <li>导出是快照，后续修订不会改变已下载文件。</li>
      </ul>
    </section>

    <section class="manual-section">
      <h2><span>09</span>本节就是使用说明</h2>
      <p>侧栏的「使用说明」始终指向这份手册；模块切换、快捷键与 AI 接口都集中在这里。遇到不确定的操作，先看“做什么”，再看“怎么用”。</p>
      <div class="manual-key"><b>通用：</b>所有输入框支持 <kbd>Tab</kbd> 切换；弹窗 / AI 面板可用 <kbd>Esc</kbd> 关闭。</div>
    </section>`;
  }

  /* ------------------------------------------------------------------ boot */
  const clock = () => {
    const el = $('#ticker-clock');
    if (el) el.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  };
  setInterval(clock, 1000);
  clock();
  duplicateTicker();
  bootSequence();
  bindCursor();
  bindMagnetic();
  window.addEventListener('resize', () => { moveRailInk(); scrollRailToActive(); });
  setTimeout(moveRailInk, 80);

  const session = readSession();
  if (session) enterApp(session);
  else {
    $('#auth').hidden = false;
    $('#auth').classList.remove('hidden');
    $('#app').hidden = true;
    $('#app').classList.add('hidden');
  }
})();
