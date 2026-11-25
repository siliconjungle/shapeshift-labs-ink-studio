/* Linked files keep an approved embedded raster for portable builds. */
(function (K) {
  const A = K.authoring, {freeze} = K.procedural.data;
  const modes = ['manual','on-load'];
  const digest = value=>typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const record = value=>value && Object.getPrototypeOf(value) === Object.prototype;

  function prepare(scene) {
    const links = scene.tilesetSources === undefined ? {} : scene.tilesetSources;
    if (!record(links)) throw new TypeError('Tileset sources need a map of sheet IDs');
    const entries = Object.entries(links).map(([id,link])=>{
      if (!A.tilesets.validId(id) || !Object.hasOwn(scene.tilesets ?? {},id))
        throw new RangeError('Source link refers to unknown tileset '+id);
      if (!record(link) || Object.keys(link).some(key=>!['file','refresh','sha256'].includes(key)) ||
          !A.assetReferences.localFile(link.file) || !/\.png$/i.test(link.file) ||
          !modes.includes(link.refresh) || !digest(link.sha256))
        throw new TypeError('Tileset '+id+' needs a relative PNG, a manual or on-load refresh mode, and a SHA-256 baseline');
      return [id,{file:link.file,refresh:link.refresh,sha256:link.sha256}];
    });
    return freeze(Object.fromEntries(entries));
  }

  A.tilesetSources = Object.freeze({prepare});
})(KIT);
