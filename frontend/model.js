/* VECTOR model bridge — talks to the original vision service contract.
 * Endpoint can be overridden by editing this file; if the service is offline
 * the detect page falls back to the local vehicle fixture. */
window.VECTOR_MODEL = (function () {
  'use strict';

  const config = {
    baseUrl: 'http://127.0.0.1:8000',
    prefix: '/api/v1',
    timeoutMs: 20000
  };

  const url = path => config.baseUrl.replace(/\/$/, '') + config.prefix + path;

  async function request(path, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), config.timeoutMs);
    try {
      const res = await fetch(url(path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
        credentials: 'same-origin'
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) {}
      if (!res.ok) {
        const message = data && data.error && data.error.message
          ? data.error.message : (text || 'HTTP ' + res.status);
        const error = new Error(message);
        error.code = data && data.error ? data.error.code : 'MODEL_HTTP_' + res.status;
        throw error;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async function createSession({ name, width, height }) {
    const data = await request('/vision/sessions', {
      kind: 'image', name: name || 'yard.svg', width, height
    });
    return data && (data.session_id || data.sessionId) || null;
  }

  async function detect({ dataUrl, width, height, name }) {
    let sessionId = null;
    try { sessionId = await createSession({ name, width, height }); } catch (_) { /* detect may still accept null */ }
    const data = await request('/vision/detect', {
      session_id: sessionId,
      kind: 'image',
      frame: { index: 0, time_ms: 0, width, height },
      image: { data_url: dataUrl, width, height },
      roi: null,
      point: null,
      prompt: 'vehicle',
      mode: 'full',
      options: { conf: 0.25, max_det: 80 }
    });
    return {
      sessionId,
      model: data && data.model ? data.model : null,
      elapsed: data && data.elapsed_ms != null ? data.elapsed_ms : null,
      requestId: data && data.request_id,
      detections: data && Array.isArray(data.detections) ? data.detections : []
    };
  }

  return { config, detect, createSession };
})();
