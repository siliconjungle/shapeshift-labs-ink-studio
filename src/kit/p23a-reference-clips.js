/* Hold native frames on two clocks linked by named comparison beats. */
(function (K) {
  const {takeTime, data} = K.procedural;
  const fail = message => { throw new RangeError('Reference clip: ' + message); };
  const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
  const name = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 120;
  const maxFrames = 512;
  const maxBeats = 64;
  const maxNotes = 256;
  const noteFormat = 'ink-studio/reference-clip-notes';
  const alignmentFormat = 'ink-studio/reference-clip-alignment';

  function timeline(source) {
    const { fps, startFrame = 0, frameCount } = source ?? {};
    const clock = takeTime.read(fps);
    const rate = takeTime.seconds(clock);
    if (rate < .001 || rate > 1000 || !integer(startFrame, 0, 1e9) || !integer(frameCount, 1, maxFrames) ||
        startFrame + frameCount > 1e9 + 1) fail('expected a positive picture rate and bounded frame span');
    return { fps: takeTime.pack(clock), rate, startFrame, frameCount, endFrame: startFrame + frameCount };
  }

  function create({ reference, candidate, beats = [] } = {}) {
    const left = timeline(reference), right = timeline(candidate);
    if (!Array.isArray(beats) || beats.length > maxBeats) fail('expected up to ' + maxBeats + ' named beats');
    const names = new Set();
    const anchors = Array.from(beats, (beat, i) => {
      const { id, label = id, reference, candidate } = beat ?? {};
      if (!name(id) || !name(label) || names.has(id) ||
          !integer(reference, left.startFrame, left.endFrame - 1) ||
          !integer(candidate, right.startFrame, right.endFrame - 1))
        fail('beats need unique IDs and one frame in each source');
      if (i && (reference <= beats[i-1].reference || candidate <= beats[i-1].candidate))
        fail('beats must increase strictly in both clips');
      names.add(id);
      return { id, label, reference, candidate, time:(reference-left.startFrame)/left.rate };
    });
    const duration = left.frameCount / left.rate;
    const first = { time:0, reference:left.startFrame, candidate:right.startFrame };
    const end = { time:duration, reference:left.endFrame, candidate:right.endFrame };
    const points = [...(anchors[0]?.time === 0 ? [] : [first]), ...anchors, end];
    const byId = new Map(anchors.map((beat, i) => [beat.id, { beat, end:anchors[i+1]?.time ?? duration }]));
    const boundedTime = time => {
      if (!Number.isFinite(time)) fail('playhead time must be finite');
      return Math.min(duration, Math.max(0, time));
    };
    function frameAddress(source, position) {
      // A floating point beat endpoint can land just below its exact source frame.
      const nearest = Math.round(position);
      const slot = Math.abs(position-nearest) < 1e-9 ? nearest : Math.floor(position);
      const index = Math.max(0, Math.min(source.frameCount-1, slot));
      const frame = source.startFrame + index;
      return { frame, index, time:frame/source.rate };
    }
    function sample(time) {
      time = boundedTime(time);
      let i = 0;
      while (i+2 < points.length && time >= points[i+1].time) i++;
      const a = points[i], b = points[i+1], t = (time-a.time)/(b.time-a.time);
      const reference = a.reference-left.startFrame+(b.reference-a.reference)*t;
      const candidate = a.candidate-right.startFrame+(b.candidate-a.candidate)*t;
      return { time, beat:a.id ?? null, reference:frameAddress(left,reference), candidate:frameAddress(right,candidate) };
    }
    function range(id) {
      if (id === undefined || id === null) return [0,duration];
      const match = byId.get(id);
      if (!match) fail('unknown beat ' + id);
      return [match.beat.time,match.end];
    }
    function frameTime(frame) {
      if (!integer(frame,left.startFrame,left.endFrame-1)) fail('reference frame is outside the clip');
      return (frame-left.startFrame)/left.rate;
    }
    function notes(entries = []) {
      if (!Array.isArray(entries) || entries.length > maxNotes) fail('expected up to ' + maxNotes + ' frame notes');
      const ids = new Set();
      return Array.from(entries, entry => {
        const { id, time, text } = entry ?? {};
        if (!name(id) || ids.has(id) || typeof text !== 'string' || !text.trim() || text.length > 2000 ||
            !Number.isFinite(time) || time < 0 || time > duration)
          fail('notes need unique IDs, a review time, and text');
        ids.add(id);
        const address = sample(time);
        return { id, time, text:text.trim(), beat:address.beat,
          reference:address.reference.frame, candidate:address.candidate.frame };
      });
    }

    return Object.freeze({
      reference:data.freeze(left), candidate:data.freeze(right), beats:data.freeze(anchors), duration,
      sample, range, frameTime, notes, noteFormat, maxNotes
    });
  }

  function register(frame, { width, height }, [x,y] = [0,0]) {
    const {width:w,height:h,rgba:source} = frame;
    if (!integer(w,1,1048576) || !integer(h,1,1048576) || !integer(width,w,1048576) ||
        !integer(height,h,1048576) || width*height>1048576 || !integer(x,0,width-w) || !integer(y,0,height-h) ||
        !(source instanceof Uint8Array || source instanceof Uint8ClampedArray) || source.length!==w*h*4)
      fail('frame must fit its registered art grid');
    if (w===width && h===height) return {w,h,rgba:source};
    const rgba=new Uint8Array(width*height*4);
    for(let row=0;row<h;row++) {
      const from=row*w*4;
      rgba.set(source.subarray(from,from+w*4),((y+row)*width+x)*4);
    }
    return {w:width,h:height,rgba};
  }

  K.referenceClips = Object.freeze({ create, timeline, register, maxFrames, maxBeats, noteFormat, alignmentFormat });
})(KIT);
