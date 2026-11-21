/* Portable motifs and seeded transformations that preserve event identities. */
(function (K) {
  const P = K.procedural, T = P.takeTime;
  const record = value => value && typeof value === 'object' &&
    [Object.prototype,null].includes(Object.getPrototypeOf(value));
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const id = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,47}$/i.test(value) &&
    !['constructor','prototype','__proto__'].includes(value);
  const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
  const require = (condition,message) => { if (!condition) throw new RangeError(message); };
  const real = raw => T.seconds(T.read(raw));
  const mod = (x,n) => (x%n+n)%n;

  function motif(raw) {
    require(fields(raw,['id','length','events']) && (raw.id === undefined || id(raw.id)) &&
      Array.isArray(raw.events) && raw.events.length <= 512,'A motif needs a length and up to 512 events');
    const length = real(raw.length);
    require(finite(length,.0625,256),'Motif length must be .0625 to 256 beats');
    const events = Array.from(raw.events,(row,index) => {
      require(fields(row,['id','beat','duration','degree','velocity']) &&
        (row.id === undefined || id(row.id)),'Invalid motif event');
      const beat = real(row.beat), duration = real(row.duration), degree = row.degree ?? 1, velocity = row.velocity ?? .8;
      require(finite(beat,0,length) && finite(duration,1e-5,length) && beat+duration <= length+1e-9 &&
        integer(degree,-35,36) && finite(velocity,0,1),'Motif event falls outside its length, degree, or velocity range');
      return { id:row.id ?? 'note-'+index,beat,duration,degree,velocity };
    }).sort((a,b) => a.beat-b.beat);
    require(new Set(events.map(event => event.id)).size === events.length &&
      events.every((event,i) => i === 0 || event.beat >= events[i-1].beat+events[i-1].duration-1e-9),
    'Motif notes need unique IDs and cannot overlap within one voice');
    return P.data.freeze({ ...(raw.id && {id:raw.id}),length,events });
  }

  function vary(source, operations = [], seed = 0) {
    require(Array.isArray(operations) && operations.length <= 16 && Number.isSafeInteger(seed),'Invalid motif edits or seed');
    let value = motif(source);
    for (const [index,op] of Array.from(operations).entries()) {
      require(record(op),'Motif operations need named settings');
      let {length,events} = value;
      const rng = K.grow.dice(P.data.hash(JSON.stringify(['motif',seed,index])));
      switch (op.type) {
        case 'repeat': {
          require(fields(op,['type','count']) && integer(op.count,1,16) &&
            length*op.count <= 256 && events.length*op.count <= 512,'Invalid motif repeat count');
          const copy = events, ids = new Set(copy.map(row=>row.id));
          events = Array.from({length:op.count},(_,i)=>copy.map((row,j)=>{
            if (!i) return row;
            let key = 'repeat-'+i+'-'+j;
            while (ids.has(key)) key += '-r';
            ids.add(key);
            return {...row,id:key,beat:row.beat+i*length};
          })).flat();
          length *= op.count;
          break;
        }
        case 'accentShift': {
          require(fields(op,['type','steps']) && integer(op.steps,-512,512),'Accent shift needs an integer event count');
          events = events.map((row,i)=>({...row,velocity:events[mod(i-op.steps,events.length)].velocity}));
          break;
        }
        case 'answer': {
          require(fields(op,['type','shift']) && integer(op.shift ?? 0,-12,12),'Invalid motif answer');
          const pivot = events[0]?.degree ?? 1;
          events = events.map(row=>({...row,degree:2*pivot-row.degree+(op.shift ?? 0)}));
          break;
        }
        case 'thin': {
          require(fields(op,['type','keep']) && finite(op.keep,0,1),'Thinning needs a keep probability in [0,1]');
          events = events.filter((_,i)=>i===0 || rng()<op.keep);
          break;
        }
        case 'transpose':
          require(fields(op,['type','degrees']) && integer(op.degrees,-24,24),'Transpose needs a bounded degree shift');
          events = events.map(row=>({...row,degree:row.degree+op.degrees}));
          break;
        case 'syncopate': {
          const amount = op.amount ?? .25, chance = op.chance ?? .5;
          require(fields(op,['type','amount','chance']) && finite(amount,0,2) && finite(chance,0,1),
            'Invalid syncopation amount or probability');
          const original = events;
          events = [];
          for (const [i,row] of original.entries()) {
            const before = events.at(-1);
            const low = before ? before.beat+before.duration : 0;
            const high = Math.max(low,(original[i+1]?.beat ?? length)-row.duration);
            const shift = rng()<chance ? amount*(rng()<.5 ? -1 : 1) : 0;
            events.push({...row,beat:Math.max(low,Math.min(high,row.beat+shift))});
          }
          break;
        }
        case 'reverse':
          require(fields(op,['type']),'Reverse takes no extra options');
          events = events.map(row=>({...row,beat:length-row.beat-row.duration}));
          break;
        default: throw new RangeError('Unknown motif operation '+String(op.type));
      }
      value = motif({...value,length,events});
    }
    return value;
  }

  function inspect(raw) {
    const {length,events} = motif(raw);
    return {length,count:events.length, density:events.length/length,
      occupied:events.reduce((sum,row) => sum+row.duration,0)/length,
      contour:events.slice(1).map((row,i)=>Math.sign(row.degree-events[i].degree)),
      accents:events.filter(row=>row.velocity>=.78).map(row=>row.beat),
      offbeats:events.filter(row=>Math.abs(row.beat-Math.round(row.beat))>1e-7).map(row=>row.beat) };
  }
  function generate(raw) {
    require(fields(raw,['length','grid','count','degrees','first','last','gate','seed']),'Invalid motif generator options');
    const length=real(raw.length), grid=real(raw.grid ?? .5), {count=4, degrees=[1,2,3,5,6], first, last,
      gate=.65,seed=0}=raw;
    const slots=Math.floor(length/grid+1e-9);
    require(finite(length,.0625,256) && finite(grid,1e-4,256) && integer(slots,1,512) &&
      integer(count,1,slots) && Array.isArray(degrees) && degrees.length > 0 && degrees.length <= 72 &&
      Array.from(degrees).every(degree=>integer(degree,-35,36)) &&
      [first,last].every(degree=>degree === undefined || degrees.includes(degree)) &&
      !(count===1 && first!==undefined && last!==undefined && first!==last) &&
      finite(gate,.1,1) && Number.isSafeInteger(seed),'Invalid degree choices, rhythm grid, count, gate or seed');
    const rng=K.grow.dice(P.data.hash(JSON.stringify(['generate-motif',seed])));
    const candidates=Array.from({length:slots-1},(_,i)=>({slot:i+1,weight:rng()})).sort((a,b)=>a.weight-b.weight);
    const times=[0,...candidates.slice(0,count-1).map(row=>row.slot).sort((a,b)=>a-b)];
    let prior = first ?? degrees[Math.floor(rng()*degrees.length)];
    return motif({length,events:times.map((slot,i)=>{
      const near=degrees.filter(degree=>Math.abs(degree-prior)<=3);
      const degree=i===0 ? first ?? (count===1 ? last : undefined) ?? prior :
        i===count-1 && last!==undefined ? last : near[Math.floor(rng()*near.length)];
      prior=degree;
      return {beat:slot*grid,duration:grid*gate,degree,velocity:slot*grid%1<1e-9 ? .89 : .66+.18*rng()};
    })});
  }
  P.musicMotif = Object.freeze({ motif,vary,inspect,generate });
  P.composerSupport = {record,fields,id,finite,integer,require,real,mod};
})(KIT);
