/* Bounded, exact contributors recorded at the native raster's requested pixel. */
const Contributions = require('../src/contribution-rules.js');
const Targets = require('../src/target-selectors.js');
const Provenance = require('../src/splat-provenance.js');

function capture(world,at,w,h) {
  if (!Array.isArray(at) || at.length !== 2 || !Array.from(at).every((n,i)=>
    Number.isSafeInteger(n) && n >= 0 && n < [w,h][i]))
    throw new RangeError('Scene fragment inspection needs [x,y] on the art grid');
  const [x,y] = at, pixel = (h-1-y)*w+x, capacity = 128;
  const slots = Array(capacity), targets = Targets.index(world);
  let count = 0, identities;
  return {
    pixel,
    add(row,depth,alpha,surface,glass,edge) {
      slots[count++%capacity] = { row,depth,alpha,surface,glass,edge };
    },
    finish() {
      const entries = Array.from({ length:Math.min(capacity,count) },(_,i)=>slots[(count-i-1)%capacity]);
      const { contributions,transmission } = Contributions.reduce(entries,1e-6);
      const hits = contributions.slice(0,32).map(({ row,depth,alpha,surface,glass,edge,weight })=>{
        const target = row >= 0 ? targets.row(row) : null;
        const kind = edge ? 'ink' : glass ? 'glass' : surface?.sdf ? 'sdf' : surface?.mesh ? 'mesh' :
          surface?.emitter ? 'emitter' : surface ? 'sprite' : 'splat';
        const identity = row >= 0 ? (identities ??= Provenance.identities(world)).idAt(row) : undefined;
        return { kind,depth,alpha,visibleCoverage:weight,object:surface?.mesh?.object ?? surface?.objectId ?? target?.object ?? null,
          part:surface?.mesh?.part ?? surface?.partId ?? target?.part ?? null,material:surface?.materialId ?? target?.material ?? null,
          ...(row >= 0 && { splatId:row+1 }),...(identity && { identity }) };
      });
      return { x,y,stage:'native-raster',hits,transmission,
        truncated:contributions.length > hits.length || count > capacity && transmission > 1e-6 };
    }
  };
}

module.exports = { capture };
