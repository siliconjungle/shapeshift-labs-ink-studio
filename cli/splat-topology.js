'use strict';

const Provenance = require('../src/splat-provenance.js');
const Targets = require('../src/target-selectors.js');
const RowAttributes = require('./splat-row-attributes.js');
const Redistribution = require('./splat-redistribution-math.js');

const maxEdits=4096;
const schema={add:['position','radius','pigment','part'],clone:['from','position'],retire:['reason'],
  split:['children'],merge:['from','weights','result']};
const newId=id=>Provenance.validId(id) && !id.startsWith('rest:');
const rgb24=n=>Number.isSafeInteger(n) && n>=0 && n<=0xffffff;
const fields=(value,keys)=>value && Object.getPrototypeOf(value)===Object.prototype &&
  Object.keys(value).every(key=>keys.includes(key));
function radius(input) {
  const value=typeof input==='number' ? [input,input,input] : input;
  if (!Array.isArray(value) || value.length!==3 || !Array.from(value).every(n=>Number.isFinite(n) && n>=.0001 && n<=10000))
    throw new RangeError('A new splat needs radii from 0.0001 to 10000 scene units');
  return value.slice();
}

function catalog(world,records,scope,supports) {
  if (!Array.isArray(records) || !records.length || records.length>maxEdits)
    throw new RangeError('Splat topology needs 1–4096 ordered edits');
  const authoredIds = Provenance.identities(world);
  const reserved = new Set(world.splatIds);
  const authored = Targets.index(world).row;
  const additions=[], created=new Map(), retired=new Map(), newRows=new Map();
  for (const record of records) {
    const {op,target,edit,id}=record??{};
    if (!Object.hasOwn(schema,op) || !fields(record,['op','target','edit','id',...schema[op]]) ||
        !Provenance.validId(edit) || !Provenance.validId(id) || !fields(target,['object','part']) || !Targets.name(target.object) ||
        target.part!==undefined && !Targets.name(target.part) ||
        scope && (target.object!==scope.object || target.part!==scope.part))
      throw new TypeError('Invalid splat topology operation or binding scope');
    if (op==='retire') {
      if (record.reason!==undefined && !Targets.name(record.reason))
        throw new TypeError('A splat retirement reason needs 1–256 characters');
      const index=resolve(id,target);
      retired.set(index,{edit,...(record.reason!==undefined && {reason:record.reason})});
      continue;
    }
    if (op==='split' || op==='merge') {
      redistribute(record);
      continue;
    }
    reserve(id);
    const position=RowAttributes.prepare('position',record.position);
    const index=world.count+additions.length;
    if (index>=0xffffff) throw new RangeError('Splat additions exceed the native row budget');
    let label, addition;
    if (op==='clone') {
      const from=resolve(record.from,target);
      label=labelAt(from);
      addition={id,from,position,label};
    } else {
      const size=radius(record.radius), part=record.part??target.part;
      if (!rgb24(record.pigment) || part!==undefined && !Targets.name(part) || target.part!==undefined && part!==target.part)
        throw new RangeError('A new splat needs a pigment and a part within its binding');
      label={object:target.object,...(part!==undefined && {part})};
      const [r,g,b]=[record.pigment>>16,record.pigment>>8&255,record.pigment&255];
      const data=new Float32Array(16);
      data.set([1,size[0]**2,0,0,r|g<<8|b<<16,size[1]**2,0,size[2]**2],3);
      addition={id,position,data,object:label.object,...(part!==undefined && {target:{part}}),label};
    }
    newRows.set(id,index);
    additions.push(addition);
    created.set(index,{op,edit,...(op==='clone' && {from:record.from})});
  }

  function reserve(id) {
    if (!newId(id) || reserved.has(id) || authoredIds.rowOf(id)>=0)
      throw new RangeError('Splat ID is reserved or already exists: '+id);
    reserved.add(id);
  }

  function redistribute({op,edit,target,id,children,from,weights,result}) {
    const sources=op==='split' ? [id] : from;
    const outputs=op==='split' ? children : [{...result,id}];
    const family=list=>Array.isArray(list) && list.length>=2 && list.length<=Redistribution.maxFamily;
    if ((op==='split' ? !family(outputs) : !family(sources)) ||
        new Set(sources).size!==sources.length || !sources.every(Provenance.validId))
      throw new RangeError('Invalid splat redistribution family');
    const shares=op==='split' ? children.map(child=>child?.weight) : weights;
    if (!Array.isArray(shares) || shares.length!==(op==='split' ? outputs.length : sources.length) ||
        !Array.from(shares).every(n=>Number.isFinite(n) && n>0 && n<=1) ||
        Math.abs(shares.reduce((a,b)=>a+b,0)-1)>1e-6)
      throw new RangeError('Redistribution needs normalized positive weights');
    const parents=sources.map(source=>resolve(source,target)), anchor=parents[0], label=labelAt(anchor);
    if (parents.some(row=> {
      const other=labelAt(row);
      return ['object','entity','part'].some(key=>label[key]!==other[key]);
    })) throw new RangeError('A splat merge needs one object and part');
    const outputIds=outputs.map(out=>out?.id);
    for (const [i,out] of outputs.entries()) {
      if (!fields(out,['id','position','covariance','opacity','pigment','scan','weight']) ||
          op==='merge' && out.weight!==undefined)
        throw new TypeError('Invalid redistributed splat snapshot');
      reserve(out.id);
      const position=RowAttributes.prepare('position',out.position);
      const index=world.count+additions.length;
      if (index>=0xffffff) throw new RangeError('Splat additions exceed the native row budget');
      const scan=checkScan(out.scan);
      additions.push({id:out.id,from:anchor,position,data:Redistribution.packedRow(out),label,pigment:out.pigment,scan});
      newRows.set(out.id,index);
      created.set(index,{op,edit,from:sources.slice(),...(op==='split' ? {weight:shares[i]} : {weights:shares.slice()})});
    }
    for (const row of parents) retired.set(row,{op,edit,replacedBy:outputIds.slice()});
  }

  function checkScan(scan) {
    if (scan===undefined) return;
    const finite=(v,count)=>Array.isArray(v) && v.length===count && Array.from(v).every(n=>Number.isFinite(Math.fround(n)));
    const harmonic=world.gaussianHarmonics;
    if (!harmonic || !fields(scan,['dc','sh','linear','normal']) || !finite(scan.dc,3) ||
        !finite(scan.sh,((harmonic.degree+1)**2-1)*3) || typeof scan.linear!=='boolean' ||
        scan.linear && !harmonic.linear || scan.normal!==undefined &&
          (!harmonic.normals || !finite(scan.normal,3) || !scan.normal.every(n=>Number.isInteger(n) && Math.abs(n)<=127)))
      throw new RangeError('Redistributed scan channels differ from their source format');
    return scan;
  }

  function labelAt(index) {
    return index<world.count ? authored(index) : additions[index-world.count].label;
  }
  function resolve(id,target) {
    const index=newRows.get(id)??authoredIds.rowOf(id);
    if (index<0 || retired.has(index) || !Targets.objectScope(target,labelAt(index)) ||
        index<world.count && !supports(world,index))
      throw new RangeError('Unavailable, retired, or out-of-scope splat: '+id);
    return index;
  }
  const patch=additions.length ? Provenance.appendStatic(world,additions) : undefined;
  return {patch,world:patch ? {...world,...patch} : world,created,retired};
}

module.exports={catalog,maxEdits,radius};
