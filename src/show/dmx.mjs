export function patchDmx(fixtures, levels) {
  if (!Array.isArray(fixtures) || fixtures.length > 512 || !levels || typeof levels !== 'object')
    throw new TypeError('Expected a fixture patch and channel levels');
  const occupied = new Set(), ids = new Set(), channels = new Uint8Array(512);
  for (const { id, address, channels: profile } of fixtures) {
    if (typeof id !== 'string' || !id || ids.has(id) || !Number.isInteger(address) || address < 1 ||
        !Array.isArray(profile) || !profile.length || address + profile.length - 1 > 512)
      throw new RangeError('Invalid DMX fixture address or channel profile');
    ids.add(id);
    const values = Object.hasOwn(levels, id) ? levels[id] : {};
    for (const [i, name] of profile.entries()) {
      const slot = address - 1 + i;
      if (typeof name !== 'string' || !name || occupied.has(slot)) throw new Error('Overlapping or invalid DMX fixture patch');
      occupied.add(slot);
      const value = Object.hasOwn(values, name) ? values[name] : 0;
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('DMX levels must be 0–1');
      channels[slot] = Math.round(value * 255);
    }
  }
  return channels;
}
