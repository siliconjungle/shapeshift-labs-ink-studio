/* Sample-clock gain shared by live faders and offline score automation. */
(function (P) {
  function at(row,frame) {
    if (!row) return 1;
    if (frame>=row.endFrame) return row.target;
    return row.from+(row.target-row.from)*(frame-row.startFrame)/(row.endFrame-row.startFrame);
  }

  function curves(initial,factors) {
    const parts=new Map();
    function lane(part,factor=null) {
      if (!parts.has(part)) parts.set(part,new Map());
      const lanes=parts.get(part);
      if (!lanes.has(factor)) lanes.set(factor,[]);
      return lanes.get(factor);
    }
    function seed(part,factor,target) {
      lane(part,factor).push({from:target,target,startFrame:0,endFrame:0});
    }
    for (const [part,value] of Object.entries(initial)) seed(part,null,value);
    for (const [part,group] of Object.entries(factors))
      for (const [factor,value] of Object.entries(group)) seed(part,factor,value);
    function append(part,factor,row) {
      const rows=lane(part,factor);
      rows.push(row);
    }
    function start(part,factor,target,startFrame,endFrame) {
      const row={from:at(lane(part,factor).at(-1),startFrame),target,startFrame,endFrame};
      append(part,factor,row);
      return row;
    }
    function read(part) {
      const lanes=parts.get(part);
      if (!lanes) return;
      const cursors=[...lanes.values()].map(rows=>{
        let index=0;
        return frame=>{
          while (index>0 && rows[index].startFrame>frame) index--;
          while (index+1<rows.length && rows[index+1].startFrame<=frame) index++;
          return at(rows[index]?.startFrame<=frame ? rows[index] : null,frame);
        };
      });
      return frame=>cursors.reduce((gain,value)=>gain*value(frame),1);
    }
    return {append,start,read};
  }

  P.musicLayerGain=Object.freeze({at,curves});
})(KIT.procedural);
