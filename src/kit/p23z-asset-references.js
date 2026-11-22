/* Exact presentation asset identities shared by hosts and portable projects. */
(function(K) {
  const A = K.authoring, format = 'ink-studio/asset-registry';
  const kinds = Object.freeze(['rig', 'voice', 'sound', 'scene', 'effect', 'graph', 'projection']);
  const record = value => value !== null && typeof value === 'object' &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const id = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_.-]*(\/[a-z0-9][a-z0-9_.-]*)+$/i.test(value) &&
    value.length <= 160;
  const revision = value => Number.isSafeInteger(value) && value > 0;
  const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const isRef = value => record(value) && Object.hasOwn(value, 'asset') &&
    (typeof value.asset === 'string' || typeof value.revision === 'number');
  const validRef = value => fields(value, ['asset', 'revision', 'sha256']) && id(value.asset) &&
    revision(value.revision) && (value.sha256 === undefined || digest(value.sha256));
  const validSlots = value => fields(value, kinds) && Object.values(value).every(validRef);
  const key = value => value.asset + '@' + value.revision;
  const localFile = value => typeof value === 'string' && value.trim() === value && value.length > 0 &&
    value.length <= 4096 && !value.startsWith('/') && !/[\\<>:"|?*\x00-\x1f]/.test(value);

  function compile(document, { draft = false } = {}) {
    if (!fields(document, ['format', 'version', 'entries']) || document.format !== format ||
        document.version !== 1 || !Array.isArray(document.entries) || document.entries.length > 4096)
      throw new TypeError('Expected a version 1 Ink asset registry');
    const entries = new Map(), types = new Map();
    for (const row of document.entries) {
      if (!fields(row, ['asset', 'revision', 'kind', 'file', 'sha256']) || !id(row.asset) ||
          !revision(row.revision) || !kinds.includes(row.kind) || !localFile(row.file) ||
          !(digest(row.sha256) || draft && row.sha256 === undefined) ||
          !row.file.toLowerCase().endsWith(['voice', 'sound'].includes(row.kind) ? '.wav' : '.json'))
        throw new TypeError('Invalid asset registry entry. Use a namespaced ID, exact revision, typed local file and SHA-256.');
      const identity = key(row);
      if (entries.has(identity)) throw new TypeError('Duplicate asset revision ' + identity);
      if (types.has(row.asset) && types.get(row.asset) !== row.kind)
        throw new TypeError('Asset kind changed across revisions of ' + row.asset);
      types.set(row.asset, row.kind);
      entries.set(identity, Object.freeze({ ...row }));
    }
    function bind(ref, expected) {
      if (!validRef(ref)) throw new TypeError('Expected an asset ID with an exact positive revision');
      const entry = entries.get(key(ref));
      if (!entry) throw new RangeError('Unknown asset revision ' + key(ref));
      if (expected && ![].concat(expected).includes(entry.kind))
        throw new TypeError(key(ref) + ' has kind ' + entry.kind + '. Expected ' + [].concat(expected).join(' or ') + '.');
      if (ref.sha256 !== undefined && ref.sha256 !== entry.sha256)
        throw new Error('Asset reference SHA-256 does not match registry for ' + key(ref));
      return entry;
    }
    return Object.freeze({ entries: Object.freeze([...entries.values()]), bind });
  }

  const visualSlots = Object.freeze({
    scene: [['rig', ['cameraRig']], ['rig', ['parts']], ['effect', ['effects']], ['effect', ['finish', 'look', 'effectPalettes']],
      ['effect', ['style', 'finish', 'look', 'effectPalettes']]],
    world: [['rig', ['visual', 'cameraRig']], ['effect', ['visual', 'look', 'effectPalettes']]]
  });
  const at = (value, path) => path.reduce((value, name) => value?.[name], value);
  function set(value, [name, ...rest], next) {
    return { ...value, [name]: rest.length ? set(value[name], rest, next) : next };
  }
  function visual(document, type, resolve) {
    let result = document;
    for (const [kind, path] of visualSlots[type]) {
      const ref = at(document, path);
      if (isRef(ref)) result = set(result, path, resolve(ref, kind));
    }
    return result;
  }
  function restoreScene(document, authored, resolved, equal) {
    for (const [, path] of visualSlots.scene) {
      const ref = at(authored, path);
      if (isRef(ref) && equal(at(document, path), at(resolved, path))) document = set(document, path, ref);
    }
    return document;
  }
  A.assetReferences = Object.freeze({ format, kinds, compile, isRef, validRef, validSlots, visual, restoreScene, key, localFile });
})(KIT);
