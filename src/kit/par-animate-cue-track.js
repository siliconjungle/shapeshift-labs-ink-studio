/* A scalar keyframe track whose keys can follow named times. */
(function (K) {
  const A = K.procedural.animationGraph;
  const {create, eases} = K.anim.keyframeTrack;
  const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const check = (condition, message) => { if (!condition) throw new RangeError('Cue track: '+message); };
  const epsilon = 1e-9;

  function cueTrack({ cues, keys, duration }) {
    check(record(cues) && Object.keys(cues).length <= 64, 'expected a bounded table of named cue times');
    check(Number.isFinite(duration) && duration > 0 && duration <= 600, 'duration must be in (0, 600] seconds');
    check(Object.values(cues).every(time => Number.isFinite(time) && time >= 0 && time <= duration),
      'cue times must be within the clip');
    check(Array.isArray(keys) && keys.length > 0 && keys.length <= 128, 'expected one to 128 keys');
    const resolved = Array.from(keys, key => {
      check(record(key) && Object.keys(key).every(name=>['at','cue','offset','value','ease'].includes(name)),
        'a key needs an absolute time or a cue and optional offset');
      const { at, cue, offset=0, value, ease='smooth' } = key;
      check(Number.isFinite(value) && eases.includes(ease), 'key value or ease is invalid');
      check(cue === undefined ? Number.isFinite(at) && key.offset === undefined :
        at === undefined && typeof cue === 'string' && Object.hasOwn(cues,cue) && Number.isFinite(offset),
      'a key needs an absolute time or an existing cue and optional offset');
      const time = cue === undefined ? at : cues[cue]+offset;
      check(time >= -epsilon && time <= duration+epsilon, 'key falls outside the clip');
      return { time:Math.min(duration,Math.max(0,time)), value:{ level:value }, ease };
    });
    check(resolved.every((key,i)=>!i || key.time-resolved[i-1].time>epsilon),
      'resolved key times must increase in lane order');
    const track = create({ level:'number' },resolved);
    return Object.freeze({
      keys:track.keys,
      sample:time=>track.sample(time).level
    });
  }

  A.cueTrack = cueTrack;
  A.operations['anim.cueTrack'] = {
    description:'Animate a scalar lane with absolute-time keys and offsets from named cues.',
    inputs:{ cues:'record', keys:'array<record>', duration:'seconds' },
    outputs:{ value:'number' }, time:true,
    instantiate() {
      let previous, track;
      return (inputs,{time}) => {
        const {equal} = K.world.data;
        if (!previous || inputs.duration !== previous.duration ||
            !equal(inputs.cues,previous.cues) || !equal(inputs.keys,previous.keys)) {
          track = cueTrack(inputs);
          previous = inputs;
        }
        return { value:track.sample(time) };
      };
    }
  };
})(KIT);
