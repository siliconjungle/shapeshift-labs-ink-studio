const Color = require('../src/color-space.js');
const LUT = require('../src/color-lut.js');
const { fields, record } = require('./texture-common.js');
const { kinds } = require('./deep-openexr.js').plateLayout;

const name = value => typeof value === 'string' && /^[a-z][\w.-]{0,63}$/i.test(value) &&
  !['__proto__','constructor','prototype'].includes(value);
const finite = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
const vec3 = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(n => finite(n, -1e6, 1e6));
const identity = [[1,0,0],[0,1,0],[0,0,1]];

function define(description, parameters, prepare) {
  return Object.freeze({ version: 1, description, parameters, prepare });
}

const native = {
  trim: define('Remove selected samples from the deep ray.', [], () => sample => { sample.drop = true; }),
  opacity: define('Scale coverage while preserving straight color.', ['scale'], ({ scale }) => {
    if (!finite(scale, 0, 4)) throw new RangeError('Deep opacity scale must be in [0,4]');
    return sample => { sample.alpha = Math.min(1, sample.alpha * scale); };
  }),
  depth: define('Move selected point samples along the camera axis before sorting.', ['offset'], ({ offset }) => {
    if (!finite(offset, -1e6, 1e6)) throw new RangeError('Deep depth offset exceeds its range');
    return sample => { sample.z += offset; };
  }),
  color: define('Apply exposure, a 3×3 RGB matrix and a bias in declared color coordinates.',
    ['exposure','matrix','bias'], ({ exposure = 0, matrix = identity, bias = [0,0,0] }) => {
      if (!finite(exposure, -20, 20) || !Array.isArray(matrix) || matrix.length !== 3 ||
          !Array.from(matrix).every(vec3) || !vec3(bias)) throw new RangeError('Invalid deep color transform');
      const gain = 2 ** exposure;
      return ({ rgb }) => {
        const [r, g, b] = rgb;
        for (let c = 0; c < 3; c++) {
          const [x, y, z] = matrix[c];
          rgb[c] = gain * (x*r + y*g + z*b) + bias[c];
        }
      };
    }),
  lut: define('Sample an authored 3D color table in declared color coordinates.', ['table'], ({ table }) => {
    if (!table || table.color !== undefined) throw new TypeError('Declare the LUT color contract on the effect');
    const apply = LUT.prepare(table);
    return ({ rgb }) => { apply(rgb, rgb); };
  })
};

function registry(extensions = {}) {
  if (!record(extensions) || Object.keys(extensions).length > 32)
    throw new TypeError('Deep effect registry needs named operator definitions');
  const rows = new Map(Object.entries(native));
  for (const [id, row] of Object.entries(extensions)) {
    if (!name(id) || rows.has(id) || !fields(row, ['version','description','parameters','prepare']) ||
        !Number.isSafeInteger(row.version) || row.version < 1 || typeof row.description !== 'string' ||
        !Array.isArray(row.parameters) || !row.parameters.every(name) || typeof row.prepare !== 'function')
      throw new TypeError('Invalid Ink deep effect definition for ' + id);
    rows.set(id, row);
  }
  return rows;
}

function list(rows = registry()) {
  return Array.from(rows, ([id, { version, description, parameters }]) => ({ id, version, description, parameters, scope: 'sample' }));
}

function selection(select, sources) {
  if (!fields(select, ['source','object','material','kind','depth','rect']))
    throw new TypeError('Invalid deep sample selector');
  const { source, object, material, kind, depth, rect } = select;
  if (source !== undefined && !sources.includes(source) ||
      [object, material].some(value => value !== undefined && !(typeof value === 'string' && value.length > 0 &&
        value.length <= 1024 || Number.isSafeInteger(value) && finite(value, 0, 0xffffffff))) ||
      kind !== undefined && !Object.hasOwn(kinds, kind) ||
      depth !== undefined && (!Array.isArray(depth) || depth.length !== 2 || !Array.from(depth).every(n => finite(n, 0, 1e6)) || depth[0] > depth[1]) ||
      rect !== undefined && (!Array.isArray(rect) || rect.length !== 4 ||
        !Array.from(rect).every((n, i) => Number.isSafeInteger(n) && finite(n, i >= 2 ? 1 : 0, 16384))))
    throw new RangeError('Invalid deep source, labels, depth range or pixel rectangle');
  const match = (selector, id, label) => selector === undefined || selector === id || selector === label;
  return v => (source === undefined || v.source === source) && match(object, v.objectId, v.object) &&
    match(material, v.materialId, v.material) && (kind === undefined || v.kind === kinds[kind]) &&
    (!depth || v.z >= depth[0] && v.z <= depth[1]) &&
    (!rect || v.x >= rect[0] && v.y >= rect[1] && v.x < rect[0] + rect[2] && v.y < rect[1] + rect[3]);
}

function compile(settings, rows, sourceNames, working) {
  if (!Array.isArray(settings) || settings.length > 32) throw new RangeError('Choose up to 32 deep effects');
  const ids = new Set();
  return settings.map(raw => {
    if (!fields(raw, ['id','operator','version','select','params','color']) || !name(raw.id) || ids.has(raw.id))
      throw new TypeError('Deep effects need distinct IDs and a named operator');
    const { id, operator, version = 1, select = {}, params = {}, color } = raw;
    ids.add(id);
    const row = rows.get(operator);
    if (!row || row.version !== version || !fields(params, row.parameters))
      throw new TypeError('Unknown deep effect operator, version or parameters for ' + id);
    if (color !== undefined && !fields(color, ['input','output'])) throw new TypeError('Invalid deep effect color contract');
    const input = Color.descriptor(color?.input ?? working), output = Color.descriptor(color?.output ?? working);
    const enter = Color.prepare(working, input), leave = Color.prepare(output, working);
    const matches = selection(select, sourceNames), apply = row.prepare(params, { input, output });
    if (typeof apply !== 'function') throw new TypeError('Deep effect needs a synchronous sample function');
    return { id, operator, version, select, params, color: { input, output }, matches,
      apply(sample) {
        enter(sample.rgb, sample.rgb);
        const result = apply(sample);
        if (result !== undefined) throw new TypeError('Deep effects edit a sample synchronously and return undefined');
        if (!sample.drop) leave(sample.rgb, sample.rgb);
      } };
  });
}

module.exports = { registry, list, compile, name, finite };
