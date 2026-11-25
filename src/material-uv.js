/* UV layout addresses shared by authored topology, sampling, baking and interchange. */
const MaterialUV = (() => {
  const channels = ['pigment','normal','metallicRoughness','emission','decal','bake','masks'];
  const layout = n => Number.isSafeInteger(n) && n>=0 && n<=31;
  const channel = id => typeof id==='string' &&
    (channels.includes(id) || /^mask\/[a-z0-9][a-z0-9_-]{0,63}$/.test(id));
  const record = row => row && Object.getPrototypeOf(row)===Object.prototype;
  const key = set => 'uv/'+set;
  const isKey = value => typeof value==='string' && /^uv\/[1-9]\d*$/.test(value) && layout(+value.slice(3));
  const setsOf = corner => Object.keys(corner.attributes ?? {}).filter(isKey).map(id=>+id.slice(3));

  function bindings(value) {
    if (value===undefined) return;
    if (!record(value) || Object.entries(value).some(([id,set])=>!channel(id)||!layout(set)))
      throw new TypeError('Material UV bindings need named channels and UV sets from 0 to 31');
    return Object.freeze(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:1)));
  }

  function resolve(value, id = 0) {
    if (layout(id)) return id;
    if (!channel(id)) throw new TypeError('Choose a UV set number or a bound material channel');
    return value?.[id] ??
      (id.startsWith('mask/') ? value?.masks ?? value?.bake : ['normal','metallicRoughness','emission','masks'].includes(id) ? value?.bake : 0) ?? 0;
  }

  function flags(value) {
    if (value===undefined) return;
    if (!record(value) || Object.entries(value).some(([id,flag])=>!isKey('uv/'+id)||typeof flag!=='boolean'))
      throw new TypeError('UV seam and pin flags need booleans on alternate layout numbers');
    const entries=Object.entries(value).filter(([,flag])=>flag);
    return entries.length ? Object.freeze(Object.fromEntries(entries)) : undefined;
  }

  const uv = (corner,set) => set ? corner.attributes?.[key(set)] : corner.uv;
  const pinned = (corner,set) => Boolean(set ? corner.uvPins?.[set] : corner.uvPinned);
  const seam = (edge,set) => Boolean(set ? edge.uvSeams?.[set] : edge.uvSeam);
  return Object.freeze({ channels, layout, channel, key, isKey, setsOf, bindings, resolve, flags, uv, pinned, seam });
})();
if (typeof module!=='undefined') module.exports=MaterialUV;
