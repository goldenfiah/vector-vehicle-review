/* VECTOR data bridge — SQLite-backed API when served by backend/server.py. */
window.VECTOR_DATA = (function () {
  'use strict';

  async function request(path, options) {
    document.dispatchEvent(new CustomEvent('vector:request', { detail: { on: true } }));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(path, {
        headers: { Accept: 'application/json', ...(options && options.body ? { 'Content-Type': 'application/json' } : {}) },
        ...options,
        signal: ctrl.signal
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) {
        const message = data && data.error ? data.error.message : 'HTTP ' + res.status;
        throw new Error(message);
      }
      return data;
    } finally {
      clearTimeout(timer);
      document.dispatchEvent(new CustomEvent('vector:request', { detail: { on: false } }));
    }
  }

  return {
    health: () => request('/api/health'),
    project: id => request('/api/projects/' + encodeURIComponent(id)),
    detections: id => request('/api/projects/' + encodeURIComponent(id) + '/detections'),
    versions: id => request('/api/projects/' + encodeURIComponent(id) + '/versions'),
    stats: id => request('/api/projects/' + encodeURIComponent(id) + '/stats'),
    task: id => request('/api/projects/' + encodeURIComponent(id) + '/tasks', { method: 'POST', body: '{}' }),
    addDetection: (id, payload) => request('/api/projects/' + encodeURIComponent(id) + '/detections', {
      method: 'POST', body: JSON.stringify(payload)
    }),
    patch: (id, patch) => request('/api/detections/' + encodeURIComponent(id), {
      method: 'PATCH', body: JSON.stringify(patch)
    }),
    saveVersion: (id, payload) => request('/api/projects/' + encodeURIComponent(id) + '/versions', {
      method: 'POST', body: JSON.stringify(payload)
    })
  };
})();
