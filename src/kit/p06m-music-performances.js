/* Build editable performance-only revisions for the existing audition path. */
(function (P) {
  const A=P.musicProduction, {record,fields,id,check}=P.musicInstruments;

  function planPerformances(source,takes,assets={}) {
    check(Array.isArray(takes) && takes.length>=1 && takes.length<=8,'Choose one to eight performance takes');
    const variants=[], reports=[], used=new Set();
    for (const take of Array.from(takes)) {
      check(fields(take,['id','tracks','unpin']) && id(take.id) && !used.has(take.id) &&
        record(take.tracks ?? {}) && Object.keys(take.tracks ?? {}).length<=8 &&
        (take.unpin===undefined || Array.isArray(take.unpin)),'Invalid performance take');
      used.add(take.id);
      const tracks=Object.fromEntries(Object.entries(take.tracks ?? {}).map(([name,gestures])=>{
        check(id(name) && Object.hasOwn(source.tracks ?? {},name) && Array.isArray(gestures),
          'A performance take maps existing tracks to gesture placements');
        return [name,{gestures:JSON.parse(JSON.stringify(gestures))}];
      }));
      const variant={id:take.id,...(Object.keys(tracks).length && {tracks}),...(take.unpin && {unpin:take.unpin.slice()})};
      const production=Object.keys(variant).length===1 ? source : A.revise(source,variant,assets);
      const result=A.compile(production,assets);
      const parts=Object.fromEntries(Object.entries(result.events).map(([part,events])=>[
        part,{events:events.length,shaped:events.filter(note=>note.gesture).length,
          connected:events.filter(note=>note.connected).length,gestures:result.tracks[part].gestures.map(({curves,mixers,...row})=>row)}
      ]));
      variants.push(variant);
      reports.push({id:take.id,parts});
    }
    return P.data.freeze({variants,report:{takes:reports}});
  }

  P.musicProduction=Object.freeze({...A,planPerformances});
})(KIT.procedural);
