/* Authored cel clips and native-pixel cue presets. */
const PixelStampPresets = (() => {
  const glitter = typeof GlitterBurstCels === 'undefined' ? require('./glitter-burst-cels.js') : GlitterBurstCels;
  const tileCels = typeof PixelTileCels === 'undefined' ? require('./pixel-tile-cels.js') : PixelTileCels;
  const contactCels = typeof ContactMarkCels === 'undefined' ? require('./contact-mark-cels.js') : ContactMarkCels;
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;

  function clips(){
    const effect=(palette,durations,cels,playback='once')=>({
      width:cels[0][0].length,height:cels[0].length,palette,playback,origin:'top-left',
      frames:cels.map((rows,i)=>({rows,duration:durations[i]}))
    });
    const sky=['#526878','#81969a','#b4c9b5','#f9e8b4','#fff8da'];
    const light=['#73505a','#bf7c4e','#f0b66b','#ffe3a4','#fff8d9'];
    const dew=['#456c7c','#74a6ab','#aad1b8','#f1f6cf','#47656d','#987990'];
    const heat=['#593148','#893d50','#bd4d48','#e66b43','#f89b55','#ffc576','#ffe2a1','#fff5ca'];

    // The four-by-three star uses a different center column at its peak.
    const star=effect(sky,[2.40,.18,.10,.13,.18,1.01],[
      ['....','..0.','....'],['....','..1.','....'],['.1..','..23','....'],
      ['.2..','1342','..1.'],['....','.23.','..1.'],['....','..0.','....']
    ],'loop');
    const far=effect(sky,[2.85,.16,.22,.77],[['0'],['2'],['1'],['0']],'loop');
    const seven=effect(sky,[2.46,.17,.09,.12,.15,1.01],[
      ['.......','.......','.......','...0...','.......','.......','.......'],
      ['.......','.......','...1...','...2...','.......','.......','.......'],
      ['.......','.......','...2...','..1331.','...1...','.......','.......'],
      ['...1...','...2...','...3...','1234320','...3...','...2...','...1...'],
      ['.......','.......','...2...','..2331.','...1...','.......','.......'],
      ['.......','.......','.......','...0...','.......','.......','.......']
    ],'loop');

    const start=effect(light,[.09,.10],[['...','..2','.1.'],['..1','.34','12.']]);
    const sweep=effect(light,[.09,.08,.11],[
      ['.......','.....24','...133.','..122..','.01....'],
      ['.....14','...123.','..023..','.112...','.......'],
      ['.....2.','...134.','..12...','.......','.......']
    ]);
    const echo=effect(light,[.09,.08,.12],[['..2','134','.2.'],['...','.23','..1'],['...','..1','...']]);

    // At the largest pose, lift the crown one pixel and move the side hole
    // from the lower right to the upper left. The center stays transparent.
    const bubble=effect(dew,[.22,.40,.44,.32],[
      ['.........','.........','...21....','..3..1...','..2...0..','...4..0..','....44...','.........'],
      ['.........','...221...','..32..1..','.2.....1.','.0.....0.','.0.......','..4....5.','...4445..'],
      ['...221...','..3...1..','.3.....1.','.0......0','0.......0','0........','.4......5','..444555.'],
      ['..3221...','.32...1..','2......0.','0.......0','0.......4','.........','.4......5','..44455..']
    ]);
    const tiny=effect(dew,[.24,.48,.32],[
      ['.....','..2..','.3.1.','..4..','.....'],['.322.','2...1','0...0','0....','.445.'],['.221.','3...1','0...0','....5','.445.']
    ]);
    const pop=effect(dew,[.075,.085,.125,.14],[
      ['....3....','..32..1..','.2.......','0.......1','0.......0','........5','.4.....5.','..44.....'],
      ['..3...1..','.2.......','.........','0.......1','........0','.........','.4......5','...4.....'],
      ['.2.....1.','.........','0........','.........','........0','.........','.........','....4....'],
      ['.........','0........','.........','.........','........4','.........','.........','.........']
    ]);
    const popTiny=effect(dew,[.075,.095,.12],[['.32..','2...1','0....','....5','.44..'],
      ['.2.1.','.....','0...0','.....','...4.'],['2....','.....','.....','.....','....0']]);
    const ripple=effect(dew,[.10,.14,.16],[['....22.....'],['..11..110..'],['00......000']]);

    const tongue=effect(heat,[.115,.13,.14,.145,.12,.14,.21],[
      ['.......','.......','...2...','..354..','...675.','...465.','..234..'],
      ['.......','....3..','...465.','...675.','...454.','..355..','..23...'],
      ['....3..','...475.','...566.','....3..','.......','...3...','..2....'],
      ['...354.','...465.','....3..','.......','...2...','.......','.......'],
      ['....3..','...354.','.......','.......','.....2.','.......','.......'],
      ['.......','....2..','.......','.....1.','.......','.......','.......'],
      ['.......','.......','.....0.','.......','.......','.......','.......']
    ]);
    const chip=effect(heat,[.12,.16,.19,.20,.24],[
      ['.....','..3..','.256.','..4..','.....'],['.....','..4..','..65.','...3.','.....'],
      ['.....','..3..','...4.','.....','..2..'],['.....','.....','...2.','.....','.....'],
      ['.....','.....','....0','.....','.....']
    ]);
    const ash=effect(heat,[.12,.17,.29],[['34'],['.2'],['.0']]);
    const burst=effect(heat,[.065,.095,.105,.115,.16,.20],[
      ['.............','.............','.............','.............','......5......','.....575.....','......6......','.............','.............','.............','.............'],
      ['.............','.......3.....','......45.....','......5..4...','....5.6.55...','..455.76..4..','....5.6......','.....55......','....43..3....','.............','.............'],
      ['.........2...','.......34....','.......45.3..','.....4....54.','....45...5...','.345...5...3.','....5.4......','...454...4...','..34...3.....','.2...........','.............'],
      ['..........2..','........23...','......4....3.','...........4.','..34.....3...','234........32','.............','...4.....3...','..3..........','.2.....2.....','2............'],
      ['...........1.','.......2.....','............2','.......3.....','..2..........','12..........2','.............','...2.........','...........2.','..1..........','0......1.....'],
      ['............0','.........1...','.............','.............','.1...........','0............','.............','............1','.............','...0.........','........0....']
    ]);
    const bed=effect(heat,[.22,.25,.26,.27],[
      ['..2..','..3..','.35..','.456.','..565','34563'],['..3..','..46.','.456.','.565.','456..','33433'],
      ['.....','...2.','..346','..565','.3563','23433'],['.....','..2..','..3..','.254.','34654','33543']
    ],'loop');
    const signal = ['#34465f', '#678098', '#a9c5d4', '#edf9f7'];
    const glyph = cels => effect(signal, [.09, .12, .13, .18], cels);
    // All phases share a center. The contours are redrawn at each size.
    const cross = glyph([
      ['.......','.......','...1...','..121..','...1...','.......','.......'],
      ['...2...','..232..','..333..','2333332','..333..','..232..','...2...'],
      ['.......','...0...','...1...','.01110.','...1...','...0...','.......'],
      ['.......','.......','...0...','..000..','...0...','.......','.......']
    ]);
    const outlinedCross = glyph([
      ['.......','...1...','..1.1..','.1...1.','..1.1..','...1...','.......'],
      ['..232..','..3.3..','233.332','3.....3','233.332','..3.3..','..232..'],
      ['.......','...1...','..1.1..','.1...1.','..1.1..','...1...','.......'],
      ['.......','...0...','.......','.0...0.','.......','...0...','.......']
    ]);
    const splitCross = glyph([
      ['.......','..1.1..','..1.1..','.......','..1.1..','..1.1..','.......'],
      ['..2.2..','..3.3..','233.332','.......','233.332','..3.3..','..2.2..'],
      ['.......','..1.1..','.11.11.','.......','.11.11.','..1.1..','.......'],
      ['.......','..0....','....0..','.......','..0....','....0..','.......']
    ]);
    const ring = glyph([
      ['.......','.......','...1...','..1.1..','...1...','.......','.......'],
      ['..232..','.3...3.','3.....3','3.....3','3.....3','.3...3.','..232..'],
      ['.......','..11...','.1...1.','.0...1.','.1...0.','...11..','.......'],
      ['.......','...0...','..0.0..','.......','..0.0..','...0...','.......']
    ]);
    const diamond = glyph([
      ['.......','...1...','...1...','.11211.','...1...','...1...','.......'],
      ['...2...','...3...','..333..','2333332','..333..','...3...','...2...'],
      ['.......','...0...','..111..','.01.10.','..111..','...0...','.......'],
      ['.......','.......','.......','...0...','.......','.......','.......']
    ]);
    const fourDot = glyph([
      ['.......','.......','..1.1..','.......','..1.1..','.......','.......'],
      ['.......','.32.23.','.33.33.','.......','.33.33.','.23.32.','.......'],
      ['.......','..0.0..','.1...1.','.......','.1...1.','..0.0..','.......'],
      ['.......','.......','..0.0..','.......','..0.0..','.......','.......']
    ]);
    const brackets = glyph([
      ['.......','.......','..1.1..','..1.1..','..1.1..','.......','.......'],
      ['.......','.32.23.','.3...3.','.......','.3...3.','.32.23.','.......'],
      ['.......','.10..1.','.1.....','.......','.....1.','.1..01.','.......'],
      ['.......','.......','..0....','.......','....0..','.......','.......']
    ]);
    return {star,far,seven,start,sweep,echo,bubble,tiny,pop,popTiny,ripple,tongue,chip,ash,burst,bed,
      cross,outlinedCross,splitCross,ring,diamond,fourDot,brackets};
  }

  const art = clips();
  const catalog = {
    'star-wide': ['Wide star', 'sky', art.star],
    'star-tall': ['Tall star', 'sky', art.seven],
    'star-distant': ['Distant star', 'sky', art.far],
    'glint-catch': ['Glint catch', 'light', art.start],
    'glint-sweep': ['Glint sweep', 'light', art.sweep],
    'glint-echo': ['Glint echo', 'light', art.echo],
    'bubble-rise': ['Bending bubble', 'dew', art.bubble],
    'bubble-small': ['Small bubble', 'dew', art.tiny],
    'bubble-pop': ['Bubble pop', 'dew', art.pop],
    'bubble-pop-small': ['Small bubble pop', 'dew', art.popTiny],
    'bubble-ripple': ['Bubble ripple', 'dew', art.ripple],
    'ember-rise': ['Rising ember', 'heat', art.tongue],
    'ember-chip': ['Flying chip', 'heat', art.chip],
    'ember-fleck': ['Cooling fleck', 'heat', art.ash],
    'ember-bed': ['Coal bed', 'heat', art.bed],
    'burst-spray': ['Hollow burst', 'heat', art.burst],
    'burst-fork': ['Forked flare', 'glitter', glitter.burst('fork')],
    'burst-diamond': ['Hollow diamond', 'glitter', glitter.burst('diamond')],
    'burst-fan': ['Ember fan', 'glitter', glitter.burst('fan')],
    'glyph-cross': ['Signal cross', 'signal', art.cross],
    'glyph-outline-cross': ['Signal outline cross', 'signal', art.outlinedCross],
    'glyph-split-cross': ['Signal split cross', 'signal', art.splitCross],
    'glyph-ring': ['Signal ring', 'signal', art.ring],
    'glyph-diamond': ['Signal diamond', 'signal', art.diamond],
    'glyph-four-dot': ['Signal four-dot', 'signal', art.fourDot],
    'glyph-brackets': ['Signal brackets', 'signal', art.brackets],
    ...tileCels,
    ...Object.fromEntries(Object.entries(contactCels).map(([id, art]) => {
      const [, kind, size, angle] = id.split('-');
      return [id, ['Contact ' + kind + ' · ' + size + ' · ' + (angle === 'ne' ? 'diagonal' : 'horizontal'), 'contact', art]];
    }))
  };
  const roles = {
    sky: ['dim','lit','pale','ray','core'],
    light: ['shadow','bronze','honey','cream','core'],
    dew: ['rim-dark','rim','rim-light','catchlight','recess','reflection'],
    heat: ['ash','dim','ember','red','orange','gold','hot','core'],
    glitter: ['ash','dim','ember','orange','gold','hot','core'],
    signal: ['residue', 'dim', 'lit', 'peak'],
    'tile-copper': ['shadow', 'trace', 'warm', 'lit', 'peak'],
    'tile-frost': ['shadow', 'ice', 'blue', 'lit', 'peak'],
    contact: ['ash', 'ember', 'heat', 'edge', 'core']
  };
  const labels = {star:'Star twinkle', glint:'Surface glint', bubble:'Rising bubble', ember:'Ember', burst:'Glitter burst', glyph:'Signal glyph'};
  const recipes = {
    star: {
      tall: [['star-tall',0]], wide: [['star-wide',0]], distant: [['star-distant',0]]
    },
    glint: {
      sweep: [
        ['glint-catch',0,[[0,0,0],[.19,4,-5]]],
        ['glint-sweep',.19,[[0,9,-6],[.09,19,-10],[.16,35,-11],[.28,49,-12]]],
        ['glint-echo',.60,[[0,53,-11]]]
      ],
      echo: [['glint-echo',0]]
    },
    bubble: {
      full: [
        ['bubble-rise',0,[[0,0,0],[.22,0,-3],[.62,1,-15],[1.06,4,-25],[1.38,5,-30]]],
        ['bubble-pop',1.38,[[0,5,-30]]], ['bubble-ripple',1.43,[[0,5,-30]]]
      ],
      small: [
        ['bubble-small',0,[[0,0,0],[.24,2,-5],[.72,5,-22],[1.04,4,-35]]],
        ['bubble-pop-small',1.04,[[0,4,-35]]], ['bubble-ripple',1.12,[[0,4,-35]]]
      ]
    },
    ember: {
      rising: [['ember-rise',0,[[0,0,0],[.25,2,-7],[.52,6,-16],[.73,9,-22],[1,13,-26]]]],
      chip: [['ember-chip',0,[[0,0,0],[.28,8,-7],[.55,15,-12],[.91,24,-16]]]],
      fleck: [['ember-fleck',0,[[0,0,0],[.25,4,-9],[.58,7,-16]]]],
      bed: [['ember-bed',0]]
    },
    burst: {
      spray: [['burst-spray',0,[[0,0,0],[.74,1,-2]]]],
      fork: [['burst-fork',0]], diamond: [['burst-diamond',0]], fan: [['burst-fan',0]]
    },
    glyph: {
      cross: [['glyph-cross',0]], 'outline-cross': [['glyph-outline-cross',0]], 'split-cross': [['glyph-split-cross',0]],
      ring: [['glyph-ring',0]],
      diamond: [['glyph-diamond',0]], 'four-dot': [['glyph-four-dot',0]], brackets: [['glyph-brackets',0]]
    }
  };
  const duration = source => source.frames.reduce((sum,frame)=>sum+frame.duration,0);

  function clip(name, { swatches } = {}) {
    if (!Object.hasOwn(catalog,name)) throw new RangeError('Unknown pixel stamp clip: '+name);
    const [,family,source] = catalog[name], names = roles[family];
    if (swatches!==undefined && (!record(swatches) || Object.keys(swatches).some(key=>!names.includes(key))))
      throw new TypeError('Pixel stamp '+name+' swatches need roles from '+names.join(', '));
    const result = structuredClone(source);
    result.palette = source.palette.map((color,i)=>Object.hasOwn(swatches??{},names[i]) ? structuredClone(swatches[names[i]]) : color);
    result.swatchRoles = names.slice();
    return result;
  }

  function preset(name, options = {}) {
    if (!Object.hasOwn(recipes,name)) throw new RangeError('Unknown pixel stamp preset: '+name);
    if (!record(options) || Object.keys(options).some(key=>
      !['at','variant','start','period','phase','swatches','offset','opacity','depth','objectId','materialId','keepSwatches'].includes(key)))
      throw new TypeError('Pixel stamp preset needs placement, timing and optional swatches');
    const variants = recipes[name];
    const { at, variant=Object.keys(variants)[0], start=0, phase=0, swatches, offset=[0,0],
      period:repeat,opacity,depth,objectId,materialId,keepSwatches=true } = options;
    if (!Object.hasOwn(variants,variant)) throw new RangeError('Unknown pixel stamp '+name+' variant: '+variant);
    if ((typeof at!=='function' && (!Array.isArray(at) || at.length!==3 || !Array.from(at).every(Number.isFinite))) ||
        !Number.isFinite(start) || !Number.isFinite(phase) || !Array.isArray(offset) || offset.length!==2 ||
        !Array.from(offset).every(value=>Number.isInteger(value)&&Math.abs(value)<=65500))
      throw new RangeError('Pixel stamp presets need an anchor, finite timing and an integer offset');
    const timing = variants[variant];
    const length = Math.max(...timing.map(([id,delay])=>delay+duration(catalog[id][2])));
    const period = repeat===undefined && (name==='star'||name==='ember'&&variant==='bed') ? length : repeat;
    if (period!==undefined && (!Number.isFinite(period) || period<=0 || period<length-1e-12))
      throw new RangeError('Pixel stamp preset period must cover the whole effect');
    return timing.map(([id,delay,keys=[[0,0,0]]])=>({
      stamp:clip(id,{swatches}), at:typeof at==='function'?at:at.slice(), nativePixels:true,keepSwatches,
      cue:{start:start+delay,...(period!==undefined&&{period})}, phase,
      offsets:keys.map(([age,x,y])=>[age,x+offset[0],y+offset[1]]),
      ...(opacity!==undefined&&{opacity}), ...(depth!==undefined&&{depth}),
      ...(objectId!==undefined&&{objectId}), ...(materialId!==undefined&&{materialId})
    }));
  }

  function list() {
    return {
      clips: Object.entries(catalog).map(([id,[label,family,source]])=>({
        id,label,width:source.width,height:source.height,duration:duration(source),swatchRoles:roles[family].slice()
      })),
      presets: Object.entries(recipes).map(([id,variants])=>({id,label:labels[id],variants:Object.keys(variants)}))
    };
  }

  return Object.freeze({clip,preset,list});
})();
if(typeof module!=='undefined') module.exports=PixelStampPresets;
