// Minimal GitHub REST client for the browser. The token stays in localStorage on this device.
const LS = { repo: 'oh.repo', token: 'oh.token', branch: 'oh.branch' };
const get = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const set = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} };

export const WORKFLOW = 'scrape.yml';
export const TEST_WORKFLOW = 'push-test.yml';

export function guessRepo(fallback) {
  const saved = get(LS.repo);
  if (saved) return saved;
  const h = location.hostname;
  if (h.endsWith('.github.io')) {
    const seg = location.pathname.split('/').filter(Boolean)[0];
    if (seg) return `${h.split('.')[0]}/${seg}`;
  }
  return fallback || '';
}

export const gh = {
  get repo() { return get(LS.repo); },
  get token() { return get(LS.token); },
  get connected() { return !!(get(LS.repo) && get(LS.token)); },
  save(repo, token) { set(LS.repo, repo.trim()); if (token !== undefined) set(LS.token, token.trim()); },
  forget() { set(LS.token, ''); set(LS.branch, ''); },

  async api(path, { method = 'GET', body, raw = false, allow404 = false } = {}) {
    const res = await fetch(`https://api.github.com/repos/${this.repo}${path}`, {
      method,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (allow404 && res.status === 404) return null;
    if (!res.ok) {
      let msg = `${res.status}`;
      try { msg += ' ' + (await res.json()).message; } catch {}
      const err = new Error(`GitHub: ${msg}`);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204 || res.status === 201 && !res.headers.get('content-length')) return {};
    return raw ? res.text() : res.json().catch(() => ({}));
  },

  async branch() {
    let b = get(LS.branch);
    if (!b) {
      const r = await this.api('');
      b = r.default_branch;
      set(LS.branch, b);
    }
    return b;
  },

  async test() {
    const r = await this.api('');
    set(LS.branch, r.default_branch);
    return r;
  },

  async dispatch(workflow = WORKFLOW, inputs = {}) {
    const ref = await this.branch();
    await this.api(`/actions/workflows/${workflow}/dispatches`, { method: 'POST', body: { ref, inputs } });
  },

  async latestRun(workflow = WORKFLOW, sinceMs = 0) {
    const r = await this.api(`/actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=5`);
    return (r.workflow_runs || []).find((x) => new Date(x.created_at).getTime() >= sinceMs - 15000) || null;
  },

  async run(id) { return this.api(`/actions/runs/${id}`); },
  async jobs(id) { return (await this.api(`/actions/runs/${id}/jobs`)).jobs || []; },

  async file(path) {
    const ref = await this.branch();
    return this.api(`/contents/${path}?ref=${encodeURIComponent(ref)}&t=${Date.now()}`, { raw: true });
  },

  async getVar(name) {
    const r = await this.api(`/actions/variables/${name}`, { allow404: true });
    return r ? r.value : null;
  },
  async setVar(name, value) {
    const exists = await this.api(`/actions/variables/${name}`, { allow404: true });
    if (exists) await this.api(`/actions/variables/${name}`, { method: 'PATCH', body: { name, value: String(value) } });
    else await this.api('/actions/variables', { method: 'POST', body: { name, value: String(value) } });
  },
  async hasSecret(name) {
    return !!(await this.api(`/actions/secrets/${name}`, { allow404: true }));
  },
  async setSecret(name, value) {
    const { sealSecret } = await import('./seal.js');
    const pk = await this.api('/actions/secrets/public-key');
    const encrypted_value = sealSecret(pk.key, value);
    await this.api(`/actions/secrets/${name}`, { method: 'PUT', body: { encrypted_value, key_id: pk.key_id } });
  },
};
