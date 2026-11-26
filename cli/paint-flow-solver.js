'use strict';

const fields=(row,keys)=>row && Object.getPrototypeOf(row)===Object.prototype &&
  Object.keys(row).every(key=>keys.includes(key));
const prepare=(plan,asset,placement,kit)=>kit.procedural.paintFlow.prepare(plan,asset,placement);

module.exports={fields,prepare};
