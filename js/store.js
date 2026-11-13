// Shared photo storage used by every page.
//
// API (the same for every backend, so the pages never change):
//   addPhoto({ name, blob })  → saves an original photo, notifies { type: 'added', id, name, created }
//   listPhotos()              → [{ id, name, created }] oldest first
//   getPhoto(id)              → the original photo Blob
//   deletePhoto(id)           → host only, notifies { type: 'deleted', id }
//   clearPhotos()             → host only, notifies { type: 'cleared' } (local) or 'deleted' per photo (supabase)
//   getSettings()             → { title, spotlight, cut }
//   saveSettings(patch)       → host only, notifies { type: 'settings', settings }
//   sendCommand(cmd)          → notifies { type: 'command', name, ... } (host → show page)
//   setHostKey(key) / checkHostKey() → unlock the host-only actions
//   onChange(fn)              → subscribe to the events above
//
// Backends:
//   local    → IndexedDB + BroadcastChannel (testing on one laptop, pages in separate tabs)
//   supabase → Postgres table + Storage bucket + Realtime (the live party); see supabase-setup.sql

import { config } from './config.js';

const newId = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const cleanName = (name) => (name || '').trim().slice(0, 40);

const listeners = new Set();
const notify = (ev) => listeners.forEach((fn) => { try { fn(ev); } catch (e) { console.error(e); } });

let hostKey = '';
export function setHostKey(key) { hostKey = (key || '').trim(); }

// =====================================================================
// local backend
// =====================================================================
function makeLocal() {
  const bc = 'BroadcastChannel' in self ? new BroadcastChannel('ori-space-party') : null;
  if (bc) bc.onmessage = (e) => notify(e.data);
  const emit = (ev) => { notify(ev); bc?.postMessage(ev); };

  let dbPromise;
  const db = () => (dbPromise ??= new Promise((res, rej) => {
    const r = indexedDB.open('ori-space-photos', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('photos', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const run = async (mode, fn) => {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction('photos', mode);
      const req = fn(t.objectStore('photos'));
      t.oncomplete = () => res(req ? req.result : undefined);
      t.onerror = t.onabort = () => rej(t.error);
    });
  };

  const api = {
    async addPhoto({ name, blob }) {
      const rec = { id: newId(), name: cleanName(name), created: Date.now(), blob };
      await run('readwrite', (s) => s.put(rec));
      emit({ type: 'added', id: rec.id, name: rec.name, created: rec.created });
    },
    async listPhotos() {
      const all = (await run('readonly', (s) => s.getAll())) || [];
      return all.map(({ id, name, created }) => ({ id, name, created })).sort((a, b) => a.created - b.created);
    },
    async getPhoto(id) {
      const rec = await run('readonly', (s) => s.get(id));
      return rec ? rec.blob : null;
    },
    async deletePhoto(id) {
      await run('readwrite', (s) => s.delete(id));
      emit({ type: 'deleted', id });
    },
    async clearPhotos() {
      await run('readwrite', (s) => s.clear());
      emit({ type: 'cleared' });
    },
    async getSettings() {
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem('ori-space-settings') || '{}'); } catch {}
      return { ...config.defaults, ...saved };
    },
    async saveSettings(patch) {
      const settings = { ...(await api.getSettings()), ...patch };
      try { localStorage.setItem('ori-space-settings', JSON.stringify(settings)); } catch {}
      emit({ type: 'settings', settings });
    },
    async sendCommand(cmd) { emit({ type: 'command', ...cmd }); },
    async checkHostKey() { return true; }, // no protection needed on one laptop
    subscribe() {},
  };
  return api;
}

// =====================================================================
// supabase backend
// =====================================================================
function makeSupabase() {
  let clientP = null;
  const client = () => (clientP ??= import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm')
    .then(({ createClient }) => createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }))
    .catch((e) => { clientP = null; throw e; }));

  const check = ({ error }) => { if (error) throw error; };
  const hostOnly = async (fn, args) => {
    const c = await client();
    const { data, error } = await c.rpc(fn, { k: hostKey, ...args });
    if (error) throw new Error(/not allowed/i.test(error.message) ? 'Host link required' : error.message);
    return data;
  };

  // one realtime channel per page, opened the first time someone listens or sends a command
  let channelP = null;
  const channel = () => (channelP ??= client().then((c) => new Promise((resolve) => {
    const ch = c.channel('ori-party', { config: { broadcast: { self: false } } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'photos' }, ({ new: r }) => {
        if (!r.deleted) notify({ type: 'added', id: r.id, name: r.name || '', created: Date.parse(r.created_at) });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'photos' }, ({ new: r }) => {
        if (r.deleted) notify({ type: 'deleted', id: r.id });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, ({ new: r }) => {
        if (r && r.data) notify({ type: 'settings', settings: { ...config.defaults, ...r.data } });
      })
      .on('broadcast', { event: 'command' }, ({ payload }) => notify({ type: 'command', ...payload }));
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve(ch);
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('Realtime:', status);
    });
  })));

  return {
    async addPhoto({ name, blob }) {
      const c = await client();
      const id = newId();
      check(await c.storage.from('photos').upload(id, blob, { contentType: blob.type || 'image/jpeg', upsert: false }));
      check(await c.from('photos').insert({ id, name: cleanName(name) }));
    },
    async listPhotos() {
      const c = await client();
      const { data, error } = await c.from('photos').select('id,name,created_at').eq('deleted', false).order('created_at');
      if (error) throw error;
      return data.map((r) => ({ id: r.id, name: r.name || '', created: Date.parse(r.created_at) }));
    },
    async getPhoto(id) {
      const c = await client();
      const { data } = c.storage.from('photos').getPublicUrl(id);
      const res = await fetch(data.publicUrl);
      if (!res.ok) return null;
      return res.blob();
    },
    deletePhoto: (id) => hostOnly('host_delete_photo', { pid: id }),
    clearPhotos: () => hostOnly('host_clear'),
    async getSettings() {
      const c = await client();
      const { data } = await c.from('settings').select('data').eq('id', 1).maybeSingle();
      return { ...config.defaults, ...(data?.data || {}) };
    },
    saveSettings: (patch) => hostOnly('host_save_settings', { patch }),
    async sendCommand(cmd) {
      const ch = await channel();
      await ch.send({ type: 'broadcast', event: 'command', payload: cmd });
    },
    async checkHostKey() {
      if (!hostKey) return false;
      const c = await client();
      const { data, error } = await c.rpc('host_check', { k: hostKey });
      return !error && data === true;
    },
    subscribe() { channel().catch((e) => console.error(e)); },
  };
}

const impl = config.backend === 'supabase' ? makeSupabase() : makeLocal();

export const backend = config.backend;
export const addPhoto = (p) => impl.addPhoto(p);
export const listPhotos = () => impl.listPhotos();
export const getPhoto = (id) => impl.getPhoto(id);
export const deletePhoto = (id) => impl.deletePhoto(id);
export const clearPhotos = () => impl.clearPhotos();
export const getSettings = () => impl.getSettings();
export const saveSettings = (patch) => impl.saveSettings(patch);
export const sendCommand = (cmd) => impl.sendCommand(cmd);
export const checkHostKey = () => impl.checkHostKey();
export function onChange(fn) {
  listeners.add(fn);
  impl.subscribe();
  return () => listeners.delete(fn);
}
