export async function connectShowBridge(base = '', fetcher = globalThis.fetch) {
  async function request(path, options) {
    const response = await fetcher(base + path, { cache: 'no-store', ...options });
    if (!response.headers.get('content-type')?.startsWith('application/json')) throw new Error('Ink show bridge is unavailable');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'Stage request failed');
    return data;
  }
  const { key, ...capabilities } = await request('/show/session');
  if (typeof key !== 'string' || !key) throw new Error('Invalid show session');
  const write = (path, data) => request(path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Ink-Show': key }, body: JSON.stringify(data) });
  let lease;
  return {
    capabilities,
    read(signal) { return request('/show/state', { signal }); },
    async arm() { ({ lease } = await write('/show/dmx', { action: 'arm' })); },
    dmx(channels) {
      if (!lease) return Promise.reject(new Error('Arm the configured DMX output first'));
      return write('/show/dmx', { lease, channels: Array.from(channels) });
    },
    disarm() { lease = undefined; return write('/show/dmx', { action: 'disarm' }); },
    osc(address, args) { return write('/show/osc', { address, args }); }
  };
}
