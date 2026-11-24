/** Mount a duration-weighted player on the native reference canvas. */
export function mountPixelRangePlayer(host,view,ranges) {
  host.innerHTML = `
    <label>Range <select data-native-range aria-label="Playback range"></select></label>
    <button type="button" data-native-play>Play at 1×</button>
    <button type="button" data-native-follow hidden>Follow editing frame</button>
    <output data-native-frame></output>`;
  const select = host.querySelector('select'), play = host.querySelector('[data-native-play]');
  const follow = host.querySelector('[data-native-follow]'), status = host.querySelector('output');
  let source, clock, request, elapsed = 0, start, sampled, epoch = 0, detached = false;
  const cache = new Map();

  function pause() {
    if (request !== undefined) cancelAnimationFrame(request);
    request = undefined;
    play.textContent = 'Play at 1×';
  }

  function reset() {
    pause();
    epoch++;
    sampled = undefined;
    elapsed = 0;
    detached = false;
    status.value = '';
    follow.hidden = true;
    view.setPreviewFrame(null);
  }

  function read(index) {
    if (!cache.has(index)) {
      const reader = source.readFrame;
      cache.set(index,Promise.resolve().then(()=>reader(index)));
      if (cache.size > 4) cache.delete(cache.keys().next().value);
    }
    return cache.get(index);
  }

  function show(index) {
    if (sampled === index) return;
    const serial = ++epoch;
    sampled = index;
    read(index).then(image=>{
      if (serial !== epoch) return;
      view.setPreviewFrame(image);
      const frame = source.frames[index];
      status.value = frame.label ?? frame.id ?? 'Frame '+(index+1);
    }).catch(()=>{
      if (serial !== epoch) return;
      reset();
      cache.delete(index);
      status.value = 'Could not display playback frame.';
    });
  }

  function step(now) {
    elapsed = now-start;
    if (!clock.loop) elapsed = Math.min(elapsed,clock.duration);
    show(clock.at(elapsed));
    if (!clock.loop && elapsed >= clock.duration) { pause(); return; }
    request = requestAnimationFrame(step);
  }

  function setClock() {
    const range = source.tags.find(row=>row.id === select.value);
    try {
      clock = ranges.plan(source.frames.map(row=>row.durationMs),range ?? { loop:source.loop });
      play.disabled = false;
    } catch (error) {
      clock = undefined;
      play.disabled = true;
      status.value = error.message;
    }
  }

  play.addEventListener('click',()=>{
    if (request !== undefined) { pause(); return; }
    if (!clock) return;
    if (!clock.loop && elapsed >= clock.duration) elapsed = 0;
    detached = true;
    follow.hidden = false;
    play.textContent = 'Pause preview';
    start = performance.now()-elapsed;
    show(clock.at(elapsed));
    request = requestAnimationFrame(step);
  });
  follow.addEventListener('click',reset);
  select.addEventListener('change',()=>{ reset(); setClock(); });

  return {
    setSource(next) {
      const retime = !source || source.document !== next.document || source.timingKey !== next.timingKey;
      const pixelsChanged = !source || source.key !== next.key;
      source = next;
      host.hidden = next.frames.length < 2 && !next.tags.length;
      if (retime) {
        reset();
        const prior = select.value;
        select.replaceChildren(new Option('All frames',''),...next.tags.map(tag=>new Option(tag.label ?? tag.id,tag.id)));
        if (next.tags.some(tag=>tag.id === prior)) select.value = prior;
        setClock();
      }
      if (pixelsChanged) {
        epoch++;
        cache.clear();
        sampled = undefined;
        if (detached) show(clock.at(elapsed));
      }
    }
  };
}
