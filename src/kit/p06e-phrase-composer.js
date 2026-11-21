/* Editable phrase arrangements, selective revisions, and audition references. */
(function (P) {
  const M = P.musicMotif, H = P.musicHarmony;
  const { record,fields,id,finite,integer,require,mod } = P.composerSupport;
  const arrangements = 'ink-studio/phrase-arrangement';
  const roles = {
    bass:{register:-12, voice:{waveform:'sine',gain:.23,attack:.023,release:.095,partials:[[2,.27],[3,.09]]}},
    percussion:{register:0, voice:{instrument:'hat',gain:.13,attack:.005,release:.04,motion:{follow:'fixed'}}},
    pad:{register:0, voice:{waveform:'sine',gain:.115,attack:.19,release:.28,partials:[[2,.14],[3,.06]]}},
    lead:{register:0, voice:{waveform:'triangle',gain:.15,attack:.019,release:.10,partials:[[3,.12],[5,.05]]}},
    visual:{register:0, voice:{gain:0,attack:.035,release:.22,motion:{follow:'fixed'}}}
  };
  const clone = value => JSON.parse(JSON.stringify(value));
  const roundBeat = value => Number(value.toFixed(9));
  const object = (raw,max,validate) => {
    require(record(raw) && Object.keys(raw).length <= max && Object.keys(raw).every(id),'Expected a bounded named table');
    return Object.fromEntries(Object.entries(raw).map(([key,value])=>[key,validate(value,key)]));
  };
  const blank = value => value === null || value === undefined;

  function compose(raw) {
    require(fields(raw,['score','motifs','parts','sections','seed','pins']) && record(raw.score) &&
      raw.score.voices === undefined && raw.score.duration === undefined &&
      Array.isArray(raw.sections) && raw.sections.length > 0 && raw.sections.length <= 64 &&
      Number.isSafeInteger(raw.seed ?? 0),'An arrangement needs a score template and bounded sections');
    const seed = raw.seed ?? 0, score = clone(raw.score);
    const motifs = object(raw.motifs,128,entry=>M.motif(entry));
    function material(raw) {
      if (blank(raw)) return null;
      if (typeof raw === 'string') raw = {motif:raw};
      require(fields(raw,['motif','sustain','operations','seed']) &&
        (raw.sustain === true ? raw.motif === undefined && raw.operations === undefined : Object.hasOwn(motifs,raw.motif)) &&
        (raw.seed === undefined || Number.isSafeInteger(raw.seed)),'Unknown or invalid part material');
      return clone(raw);
    }
    const parts = object(raw.parts,8,(part,key)=>{
      require(fields(part,['role','material','mode','register','pitch','voice']) && Object.hasOwn(roles,part.role),
        'A part needs a named bass, percussion, pad, lead or visual role');
      const preset = roles[part.role], {register=preset.register,pitch='chord',voice={}} = part;
      require(integer(register,-48,48) && ['chord','key'].includes(pitch) && record(voice) &&
        !['id','sequence','rhythm'].some(field=>Object.hasOwn(voice,field)),'Invalid arrangement part voice or pitch mapping');
      const mode = H.scaleSteps(part.mode ?? score.key?.mode);
      const voiceSpec = { ...preset.voice,...clone(voice),id:key };
      return { role:part.role, material:material(part.material), mode, register, pitch, voiceSpec };
    });
    require(Object.keys(parts).length > 0,'An arrangement needs at least one part');
    const clock = P.musicTiming.compile(score.tempoMap), beatsPerBar = score.tempoMap?.beatsPerBar ?? 4;
    const sections = [], names = new Set();
    let bars = 0;
    for (const section of Array.from(raw.sections)) {
      require(fields(section,['id','bars','harmony','parts']) && id(section.id) && !names.has(section.id) &&
        integer(section.bars,1,64) && (section.harmony === undefined || id(section.harmony)),
        'A section needs a unique ID and bounded bar count');
      names.add(section.id);
      const overrides = object(section.parts ?? {},8,(raw,key)=>{
        require(Object.hasOwn(parts,key),'Section overrides must name a part');
        return material(raw);
      });
      sections.push({id:section.id,bar:bars,bars:section.bars,beat:bars*beatsPerBar,
        end:(bars+section.bars)*beatsPerBar,harmony:section.harmony,overrides});
      bars += section.bars;
    }
    const pins = Array.from(new Set(raw.pins ?? []));
    require(Array.isArray(raw.pins ?? []) && pins.length <= 136,'Expected a bounded pin list');
    for (const pin of pins) {
      const [kind,key,extra] = typeof pin === 'string' ? pin.split(':') : [];
      require(!extra && (kind === 'part' && Object.hasOwn(parts,key) ||
        kind === 'binding' && Object.hasOwn(score.bindings ?? {},key)),'Pin must name a part or score binding');
    }
    const changed = sections.filter(section=>section.harmony).map(section=>({
      id:'section-'+sections.indexOf(section), time:{bar:section.bar}, harmony:section.harmony
    }));
    const cues=[], written={}, sectionMaterials={};
    for (const [key,part] of Object.entries(parts)) {
      const spans = [], entries=[];
      let current, slot = part.material;
      function addSpan(section) {
        const name = slot?.motif;
        const motif = name ? M.vary(motifs[name],slot.operations,P.data.hash(JSON.stringify([seed,key,section.id,slot.seed ?? 0]))) : null;
        current = { start:section.beat,end:section.end,slot,motif,section:section.id,name };
        spans.push(current);
      }
      for (const section of sections) {
        if (Object.hasOwn(section.overrides,key)) {
          slot = section.overrides[key];
          addSpan(section);
        } else if (!current) addSpan(section);
        else current.end = section.end;
        entries.push({section:section.id,sourceSection:current.section,
         ...(current.motif && {motif:current.name,value:current.motif,traits:M.inspect(current.motif)}),
          sustain:Boolean(current.slot?.sustain)});
      }
      const sequence=[];
      for (const span of spans) {
        if (!span.motif) {
          if (span.slot?.sustain) sequence.push({beat:span.start,duration:span.end-span.start});
          continue;
        }
        const {length,events} = span.motif;
        if (!events.length) continue;
        const repeats = Math.ceil((span.end-span.start)/length);
        require(repeats*events.length+sequence.length <= 4608,'Part exceeds its note expansion budget');
        for (let repeat = 0; repeat < repeats; repeat++) for (const event of events) {
          const beat = roundBeat(span.start+repeat*length+event.beat);
          const duration = roundBeat(Math.min(event.duration,span.end-beat));
          if (duration < 1e-5) continue;
          const index = event.degree-1;
          const step = part.mode[mod(index,part.mode.length)]+12*Math.floor(index/part.mode.length)+part.register;
          const fixed = part.pitch === 'key' || part.role === 'percussion';
          const task = part.role === 'percussion' ? 36 : H.midi(score.key?.root ?? 'C4')+step;
          sequence.push({beat,duration,level:event.velocity,...(fixed ? {midi:task} : {offset:step})});
          const section = sections.findLast(row=>row.beat <= beat);
          cues.push({id:key+'-'+sequence.length,part:key,role:part.role,section:section.id,
            motif:span.name,event:event.id,beat,time:clock.timeAt({beat}),duration,
            endTime:clock.timeAt({beat:roundBeat(beat+duration)}),degree:event.degree,velocity:event.velocity});
        }
      }
      require(sequence.length <= 4096,'Part exceeds its score note budget');
      written[key] = { role:part.role, voice:{...part.voiceSpec,sequence}, notes:sequence.length };
      sectionMaterials[key] = entries;
    }
    const native = { ...score, duration:{bar:bars}, voices:Object.values(written).map(part=>part.voice),
      changes:[...(score.changes ?? []),...changed] };
    const program = P.musicScore.compile(native);
    const table = sections.map(({id,bar,bars,beat,end})=>({id,bar,bars,beat,end,
      time:clock.timeAt({beat}),endTime:clock.timeAt({beat:end})}));
    cues.sort((a,b)=>a.time-b.time || a.part.localeCompare(b.part));
    const definition = clone(raw);
    return P.data.freeze({ format:arrangements,version:1,definition,score:native,sections:table,
      parts:written,materials:sectionMaterials,pins,cues,
      report:{bars,duration:program.duration,sectionCount:table.length,noteCount:cues.length,
        counts:Object.fromEntries(Object.entries(written).map(([key,part])=>[key,part.notes]))} });
  }

  function unpack(value) {
    if (value?.format === arrangements) {
      require(value.version === 1 && record(value.definition),'Unsupported arrangement version');
      return compose(value.definition);
    }
    return compose(value);
  }
  function reference(source,{part,section} = {}) {
    const plan = unpack(source);
    require(Object.hasOwn(plan.materials,part),'Reference must name an arrangement part');
    const item = plan.materials[part].find(row=>row.section === section);
    require(item?.value,'Reference section has no motif for this part');
    return { motif:item.value,traits:item.traits,part,section,sourceSection:item.sourceSection,
      sourceMotif:item.motif,seed:plan.definition.seed ?? 0,
      cues:plan.cues.filter(row=>row.part===part && row.section===section) };
  }

  function revise(source, { edits = [], pin = [], unpin = [] } = {}) {
    const plan = unpack(source), next = clone(plan.definition), active = new Set(plan.pins);
    require(Array.isArray(edits) && edits.length <= 128 && Array.isArray(pin) && pin.length <= 136 &&
      Array.isArray(unpin) && unpin.length <= 136,'Invalid arrangement edit or pin list');
    for (const key of unpin) active.delete(key);
    for (const key of pin) active.add(key);
    next.pins = [...active];
    const held = new Set(next.pins.filter(key=>typeof key==='string' && key.startsWith('part:')).map(key=>key.slice(5)));
    for (const key of next.pins.filter(key=>typeof key==='string' && key.startsWith('binding:'))) {
      const binding = next.score.bindings?.[key.slice(8)];
      if (binding?.voice) held.add(binding.voice);
      if (['roughness','ratioFit'].includes(binding?.from))
        for (const name of binding.pair ?? Object.keys(next.parts)) held.add(name);
    }
    const report = [];
    function registerMotif(prefix, motif) {
      const json = JSON.stringify(motif), base = prefix+'-'+P.data.hash(json).toString(36);
      let name = base, index = 1;
      while (Object.hasOwn(next.motifs,name) && JSON.stringify(next.motifs[name]) !== json)
        name = base+'-'+index++;
      next.motifs[name] = clone(motif);
      return name;
    }
    for (const edit of Array.from(edits)) {
      if (edit?.harmony !== undefined) {
        require(fields(edit,['harmony','voicing','notes','inversion']) &&
          Object.hasOwn(next.score.harmonies ?? {},edit.harmony) &&
          (edit.voicing !== undefined || edit.notes !== undefined || edit.inversion !== undefined) &&
          !(edit.voicing !== undefined && edit.notes !== undefined),'Unknown harmony or invalid voicing edit');
        const existing = next.score.harmonies[edit.harmony];
        if (edit.voicing !== undefined) {
          delete existing.notes;
          existing.voicing=clone(edit.voicing);
        }
        if (edit.notes !== undefined) {
          delete existing.voicing;
          existing.notes=clone(edit.notes);
        }
        if (edit.inversion !== undefined) existing.inversion=edit.inversion;
        report.push(clone(edit));
        continue;
      }
      if (edit?.binding !== undefined) {
        require(fields(edit,['binding','value']) && id(edit.binding) &&
          Object.hasOwn(next.score.bindings ?? {},edit.binding) && !active.has('binding:'+edit.binding) &&
          record(edit.value),'Unknown or pinned score binding');
        next.score.bindings[edit.binding] = clone(edit.value);
        report.push(clone(edit));
        continue;
      }
      require(fields(edit,['part','section','material','adopt','operations','seed']) && Object.hasOwn(next.parts,edit.part) &&
        !held.has(edit.part),'Unknown or pinned arrangement part');
      const section = edit.section === undefined ? undefined : next.sections.find(row=>row.id===edit.section);
      require(edit.section === undefined || section,'Unknown section in arrangement edit');
      require(edit.adopt === undefined || edit.material === undefined,'Adopt a motif or set a part material');
      const onlyVariations = edit.material === undefined && edit.adopt === undefined;
      let value = edit.material;
      if (edit.adopt !== undefined) {
        const motif = M.motif(edit.adopt.motif ?? edit.adopt);
        value = {motif:registerMotif('adopt',motif)};
      } else if (onlyVariations) {
        const base = compose(next);
        if (section) {
          const row = base.materials[edit.part].find(row=>row.section===section.id);
          require(row?.value,'Variation needs an active motif in this section');
          value = {motif:registerMotif('variant',row.value)};
        } else value = next.parts[edit.part].material;
      }
      if (edit.operations !== undefined || edit.seed !== undefined) {
        if (typeof value === 'string') value = {motif:value};
        require(record(value) && typeof value.motif === 'string','Variation needs an active motif');
        value = {...value,
          ...(edit.operations !== undefined && {operations:[...(value.operations ?? []),...edit.operations]}),
          ...(edit.seed !== undefined && {seed:edit.seed})};
      }
      require(value !== undefined,'Arrangement edit needs part material');
      if (section) (section.parts ??= {})[edit.part] = clone(value);
      else next.parts[edit.part].material = clone(value);
      report.push({part:edit.part,...(section && {section:section.id}),
        ...(edit.seed !== undefined && {seed:edit.seed}),
        ...(edit.operations !== undefined && {operations:clone(edit.operations)}),
        ...(edit.material !== undefined && {material:clone(edit.material)}),
        ...(edit.adopt !== undefined && {adopt: {motif:value.motif,sourcePart:edit.adopt.part ?? null,
          sourceSection:edit.adopt.section ?? null,sourceMotif:edit.adopt.sourceMotif ?? null}}) });
    }
    const value=compose(next);
    if (held.size && report.some(row=>row.harmony)) {
      const before=P.musicScore.compile(plan.score).events, after=P.musicScore.compile(value.score).events;
      for (const key of held) {
        if (!value.parts[key]?.voice.sequence.some(note=>note.offset===undefined && note.midi===undefined)) continue;
        const select = events => events.map(event=>event.voices.find(voice=>voice.id===key));
        require(JSON.stringify(select(before))===JSON.stringify(select(after)),'Voicing edit changes a pinned part: '+key);
      }
    }
    return {value,report};
  }

  function audition(source, variants, options = {}) {
    require(Array.isArray(variants) && variants.length > 0 && variants.length <= 8 &&
      fields(options,['start','end','sampleRate','audio']),'An audition needs one to eight variants and named options');
    const baseline = unpack(source), used = new Set();
    const {start=0,end=Math.min(baseline.report.duration,start+20), sampleRate=24000,audio=true} = options;
    require(finite(start,0,baseline.report.duration) && finite(end,start,baseline.report.duration) && end > start &&
      end-start <= 30 && integer(sampleRate,8000,48000) && typeof audio === 'boolean',
      'An audition range must be within the arrangement, up to thirty seconds');
    const takes = Array.from(variants, spec=>{
      require(fields(spec,['id','edits','pin','unpin']) && id(spec.id) && !used.has(spec.id),'Audition IDs must be unique');
      used.add(spec.id);
      const {value,report} = revise(baseline,{edits:spec.edits,pin:spec.pin,unpin:spec.unpin});
      const program = audio ? P.musicScore.compile(value.score).audio({start,end,sampleRate}) : undefined;
      const delta = Object.fromEntries(Object.keys(value.parts).map(key=>[key,value.parts[key].notes-baseline.parts[key].notes]));
      return {id:spec.id,arrangement:value,range:{start,end},edits:report,
        report:{...value.report,delta,...(program && {audio:program.report})}, ...(program && {audio:program.value})};
    });
    return { takes,report:{start,end,sampleRate,variants:takes.map(take=>({id:take.id,edits:take.edits,delta:take.report.delta}))} };
  }

  P.musicComposer = Object.freeze({compose,revise,reference,audition,motif:M});
  delete P.composerSupport;
})(KIT.procedural);
