/* Address input against the sample ranges actually scheduled for playback. */
export function createPassClock() {
  let partial, complete=[], epoch;
  function schedule(anchor, first, frames) {
    const {loop:{from,to}, pass, frame, scoreSample}=anchor, span=to-from;
    const key=[from,to,frame-pass*span-scoreSample+from].join('/');
    if (key!==epoch) {
      partial=undefined;
      complete=[];
      epoch=key;
    }
    let position=scoreSample, lap=pass, remaining=frames, cursor=first;
    while (remaining>0) {
      const end=position<from ? from : to;
      const count=Math.min(remaining,end-position);
      if (position===from) partial={from,to,pass:lap,first:cursor,end:cursor};
      if (partial?.pass===lap) {
        if (partial.end===cursor) {
          partial.end+=count;
          if (position+count===to) {
            complete.push(partial);
            if (complete.length>128) complete.shift();
            partial=undefined;
          }
        } else partial=undefined;
      }
      remaining-=count;
      position+=count;
      cursor+=count;
      if (position===to) {position=from;lap++;}
    }
  }
  return Object.freeze({schedule,
    last:(at, since=0)=>complete.findLast(pass=>pass.end<=at && pass.first>=since),
    passes:(at,since)=>complete.filter(pass=>pass.end<=at && pass.first>=since),
    reset() { partial=undefined;complete=[];epoch=undefined; }
  });
}

const initialControllers=()=>Object.create(null);
const cc={1:'contact',2:'breath',11:'amplitude',74:'contact'};
const add=(series,frame,value)=>{
  if (series.at(-1)?.[0]===frame) series[series.length-1]=[frame,value];
  else if (series.at(-1)?.[1]!==value) series.push([frame,value]);
};
const cap=(rows,max)=>rows.length<=max ? rows :
  Array.from({length:max},(_,i)=>rows[Math.round(i*(rows.length-1)/(max-1))]);

function slicePoints(rows, first, end, max) {
  const prior=rows.findLast(row=>row[0]<first);
  const inside=rows.filter(row=>row[0]>=first && row[0]<end);
  if (!inside.length && !prior) return [];
  const points=inside[0]?.[0]===first ? inside : [[first,prior?.[1] ?? inside[0][1]],...inside];
  return cap(points,max).map(([at,value])=>[at-first,value]);
}

export function createMidiCapture(rate, monitor=()=>{}) {
  let notes=[], lastFrame=0;
  let gesture=Object.create(null);
  const held=new Map(), states=Array.from({length:16},()=>({controls:initialControllers(),sustain:false}));
  function stop(key,frame) {
    const note=held.get(key);
    if (!note) return;
    note.end=frame;
    held.delete(key);
    monitor({type:'off',key});
  }
  function control(channel,name,value,frame,midi) {
    if (midi===undefined) states[channel].controls[name]=value;
    add(gesture[name] ??= [],frame,value);
    for (const [key,note] of held) if (note.channel===channel && (midi===undefined || midi===note.midi)) {
      add(note.curves[name] ??= [],frame,value);
      monitor({type:'control',key,name,value});
    }
  }
  function trim(frame) {
    const cutoff=frame-32*rate;
    if (notes[0]?.end<cutoff || notes.length>4096)
      notes=notes.filter(note=>note.end===undefined || note.end>=cutoff).slice(-4096);
    const series=[...Object.values(gesture),...Array.from(held.values()).flatMap(note=>Object.values(note.curves))];
    for (const rows of series) {
      const before=rows.findLastIndex(row=>row[0]<cutoff);
      const drop=Math.max(before,rows.length-8192,0);
      if (drop>0) rows.splice(0,drop);
    }
  }
  function midi(data,frame) {
    frame=Math.max(lastFrame,frame);
    lastFrame=frame;
    const [status,a,b]=data, kind=status & 0xf0, channel=status & 15, key=channel+'/'+a, state=states[channel];
    if ((kind===0x80 || kind===0x90 && b===0) && held.has(key)) {
      if (state.sustain) held.get(key).released=true;
      else stop(key,frame);
    } else if (kind===0x90 && b>0) {
      stop(key,frame);
      const values={...state.controls};
      const curves=Object.fromEntries(Object.entries(values).map(([name,value])=>[name,[[frame,value]]]));
      const note={midi:a,velocity:b/127,start:frame,channel,curves};
      held.set(key,note);
      notes.push(note);
      monitor({type:'on',key,midi:a,velocity:note.velocity,values});
    } else if (kind===0xa0) control(channel,'pressure',b/127,frame,a);
    else if (kind===0xd0) control(channel,'pressure',a/127,frame);
    else if (kind===0xe0) {
      const wheel=(b<<7|a)-8192;
      control(channel,'pitchCents',wheel*200/(wheel>0 ? 8191 : 8192),frame);
    } else if (kind===0xb0) {
      if (Object.hasOwn(cc,a)) control(channel,cc[a],b/127,frame);
      if (a===64) {
        state.sustain=b>=64;
        if (!state.sustain) for (const [key,note] of held)
          if (note.channel===channel && note.released) stop(key,frame);
      }
      if (a===120 || a===123) for (const [key,note] of held) if (note.channel===channel) stop(key,frame);
    }
    trim(frame);
  }
  function played(first,end) {
    return notes.flatMap(note=>{
      const from=Math.max(first,note.start), to=Math.min(end,note.end ?? end);
      if (to<=from) return [];
      const curves=Object.fromEntries(Object.entries(note.curves).flatMap(([name,rows])=>{
        const points=slicePoints(rows,from,to,32);
        return points.length ? [[name,points]] : [];
      }));
      return [{midi:note.midi,velocity:note.velocity,start:from-first,end:to-first,curves}];
    });
  }
  function gestures(first,end) {
    return Object.fromEntries(Object.entries(gesture).flatMap(([name,rows])=>
      rows.some(([at])=>at>=first && at<end) ? [[name,slicePoints(rows,first,end,192)]] : []));
  }
  return Object.freeze({midi,played,gestures,releaseAll(frame) {
    for (const state of states) state.sustain=false;
    for (const key of held.keys()) stop(key,Math.max(lastFrame,frame));
  },reset() {
    notes=[];
    gesture=Object.create(null);
    lastFrame=0;
    held.clear();
    for (const state of states) {state.sustain=false;state.controls=initialControllers();}
  }});
}
