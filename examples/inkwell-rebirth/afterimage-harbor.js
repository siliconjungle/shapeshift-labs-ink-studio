// Original Inkwell Rebirth scene. See README.md for the source revision.
function rebirthAfterimageHarbor(kit) {
  const { KIT, makeBuilder, makeSculpt, InkVeil, SpriteSurface } = kit;
  const { kanaGlyphs } = (typeof module === 'undefined' ? rebirthKanaGlyphs : require('./kana-glyphs.js'))(kit);

  const SpatialGrade = (() => {
    const field = 'spatial-grade';
    const mask = name => ({ type: 'query', field, path: [name], space: 'world', interpolation: 'linear' });

    function bake({ min, max, size }, channels) {
      const names = Object.keys(channels);
      if (names.length < 1 || names.length > 4 ||
          ![min,max,size].every(v => v.length === 3 && v.every(Number.isFinite)) ||
          !size.every((n,i) => Number.isInteger(n) && n > 0 && n <= 64 && max[i] > min[i]) ||
          names.some(name => typeof channels[name] !== 'function'))
        throw new RangeError('Expected a bounded grade volume and one to four named samplers');
      const [nx,ny,nz] = size, bytes = new Uint8Array(nx*ny*nz*4);
      const step = size.map((n,i) => (max[i]-min[i])/n);
      for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        const px = min[0]+(x+.5)*step[0], py = min[1]+(y+.5)*step[1], pz = min[2]+(z+.5)*step[2];
        const offset = 4*(x+nx*(y+ny*z));
        for (let i = 0; i < names.length; i++) {
          const amount = channels[names[i]](px,py,pz);
          bytes[offset+i] = Math.round(Math.max(0,Math.min(1,amount))*255);
        }
      }
      return { min,max,size,bytes,names };
    }

    function channel(grade, definition) {
      if (!grade || definition?.type !== 'query' || definition.field !== field ||
          definition.path?.length !== 1 || definition.space !== 'world' || definition.invert ||
          definition.range !== undefined || definition.interpolation !== 'linear') return -1;
      return grade.names.indexOf(definition.path[0]);
    }

    function context(grade, prior) {
      if (!grade) return prior;
      const { min,max,size,bytes,names } = grade;
      const invSpan = min.map((v,k) => 1/(max[k]-v));
      let last, values;
      return { ...prior, query: { probe(name,point,args) {
        if (name !== field) return prior?.query?.probe(name,point,args) ?? { status: 'absent' };
        if (last && point[0] === last[0] && point[1] === last[1] && point[2] === last[2])
          return { status: 'ok', value: values };
        last = [...point];
        values = Object.fromEntries(names.map(name => [name,0]));
        const uv = min.map((v,k) => (point[k]-v)*invSpan[k]);
        if (uv.some(v => v < 0 || v > 1)) return { status: 'ok', value: values };
        const axes = uv.map((v,k) => {
          const u = Math.max(0,Math.min(size[k]-1,v*size[k]-.5));
          const lo = Math.floor(u), f = u-lo;
          return [[lo,1-f],[Math.min(size[k]-1,lo+1),f]];
        });
        for (const [x,wx] of axes[0]) for (const [y,wy] of axes[1]) for (const [z,wz] of axes[2]) {
          const offset = 4*(x+size[0]*(y+size[1]*z)), weight = wx*wy*wz/255;
          for (let i = 0; i < names.length; i++) values[names[i]] += bytes[offset+i]*weight;
        }
        return { status: 'ok', value: values };
      } } };
    }
    return Object.freeze({ bake,mask,channel,context });
  })();

  const AFTERIMAGE_KOI = Object.freeze({width:96,height:44,data:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABISAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUFhMSExIAAAAAEgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASExIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAExMTPRYWPRYSEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASExMTExMTExIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD0VPRUWFhY9FRUUEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAATFRMUFBMTExMTEgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPRUWFRQVFhUVPRYWFRMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASEz0WPRUVFBQUFBMTEgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWFRYVFhQVFBUWFhYVFhUUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFhUWPT0WFhUVFRUVFBMSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVFBQWFBQVFRU9FBUVPRYUEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA9FT09PRUWFhUVFhYWFRMTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABUUFRQTExQUFBYUFBUVFRU9FQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFRYWFj0WPRYWPRUVFRYWFhQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABUUFBYTFBMUFBQUFhQVFRUVFT0UAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA9FhYWFj09PRYVFRUVFhYVEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFhQUFRITEhUSEhMTFBQVFhUUFRUVFBQTAAAAAAAAAAAAAAAAAAAAAAAAAD0VFhYWPT09FRUVFRYWFRISAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFBMVEhMUFRMUEhIVFBITFBQUFhUVFRUWFhMAAAAAAAAAAAAAAAAAAAAAPRUWFhY9PRQUFRYVFj0TFBQSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABEQERE9FBMREREREBEVFRYTERATExMTFBQVFRQVFhUTAAAAAAAAAAAAAAAAAAA9FRUVFhYWFBQVFhYWFhQVFBQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEREQEBEQERIRERASERERERERFj09PREQERESFhMUFhYWFhUTExIAAAAAAAAAAAAAABYVFRUVFhUUFBUVFRY9FRUVFRQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEBESExMSEREREhEREREQERERERERET0TPRITERITERAUFBQUFBQVFRMSAAAAAAAAAAAAEhUUFBUWFRQUFRQVFj0VFRUVFgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABERERETExM9ERIREhQSFhIVERURERERERITEBEUPRMTExETERITExMUFBUVEgAAAAAAAAASExMUFBYVFBUUFRUWFhUVFRUVFAAAAAAAAAAAAAAAAAAAAAAAAAAAABETExMTExMUExU9EhQ9ExYTPRMWEhUTEREQERESEhATPRY9Fj0UEhMQERETAAAAAAAAAAASEhESEhMTFhQVFRY9FhQVFRQVFRYUAAAAAAAAAAAAAAAAAAAAAAAAAAARExMTFBQUExMTPT0QEhY9Ez0VPRY9FD0WEBMREhMUExQTFD0TFRMUFT0REhEREBAAAAARExETExMTExIUFBY9FBUVFhUWPT09FgAAAAAAAAAAAAAAAAAAAAAAAAAAEBERERMUFBMTExU9Fj0SERMVPRQ9Ez0TFhYQEhETEhQUFBISFj09PRM9PRM9FBATEREQExMSExEQEhMTEhMTPRQVFRUWFhYVPRYWFAAAAAAAAAAAAAAAAAAAAAAAAAAVERERExQTExMSEj09EBIRERIVFhEWERUTFT0QERETEhMSExITExMSFBMTPRU9Fj09ERMUExQUFBIRERETExMVFBITExQUFBQUFRQAAAAAAAAAAAAAAAAAAAAAAAAAExYVERETExISExM9PRY9FBERFBEWFBESERIRFBASEhMTExMTExMTERARERQUEhUTEhIVEhY9FhMTExURERIRExQREhITFBQUFBQVFQAAAAAAAAAAAAAAAAAAAAAAAAASEz0RERMUFBMTExY9PRYVEBERFBMUERESERIRFBERERMSEhMTExMQERISEhERFBISExMUExQTFhYWERASERARERISEhIUFRUUFBQVFRUVFAAAAAAAAAAAAAAAAAAAABITExERERESExIRPT09PRMUEBESERIUEREQEBASFBIRFBMTExMTExIRERAQERARFBMSFBMRFBUQFhEQEREQERERERISExMUFBQWFRYWPT0WFhQAAAAAAAAAAAAAAAAAABMTFj0SExMREhERERQ9FRUWEBAQEBEQEBEQEhASFj0RPRMSEhMTExEQEBASEREUEBQTEhMREBEREBEREREREBAREhISExQUFBUUFBY9Fj09FRUVAAAAAAAAAAAAAAAAFj09FhYRERASERARERMUFBQVEBESEhETEREQEBATFj0WPRMTExY9ExEREREQEBAVEBMUExAREREREQAAAAAAAAAAExMUExQUFRQUFBUVFBYVFj0VEwAAAAAAAAAAAAAAPT09PT0VERIREhEREBMVFRUWEBEQERITEBESEBMWPRQ9FhQSFBU9EBEQERAQEBEQEREREBMUFBMAAAAAAAAAAAAAABMUFBQVFRYUFBYVFj0WFRUUFgAAAAAAAAAAAAAAAD0WFBYWFRMUPRERERQVFRMUEBIQERITEREQERAWFRYWExQUFhYSERESERERERARERATFBQVFBUVFRQAAAAAAAAAAAAAFRUUFRUWFBQWFhYVFhUUEhMAAAAAAAAAAAAAABMVPRQWFhY9FhMRFRUVFj0TEhASEhMQERAREBESERYWFBUUFhIQEhEQERARERAAEhQTFBQUFBUWFRUUAAAAAAAAAAAAFBQVFhYWFRQVFRYVFRUWFRQTEwAAAAAAAAAAAAAAPQAUFBUVFRMUFBYTFhQ9FRMSExUVFRUWERERERAREhQUExQQERERAAAAAAAAAAAVFBQTFBUVFT0WAAAAAAAAAAAAABMVFD0WFj0VFRUVFRUVFBUUExMAAAAAAAAAAAAAFAAAABITFBUTFBQWExQRFT0UFRUVFRUVFhAREBESExUTFRERAAAAAAAAAAAAAAAAFBMUExQWFhUUFgAAAAAAAAAAAAAVFhY9PRY9FRUUFBYVFBMTFRMAAAAAAAAAAAAAAAAAAAAAAAAAEhIRERIREhISFhUVFRUVFhYREhMUEhISEhITFBQUFQAAAAAAAAAAAAATEhMVFT09FhQAAAAAAAAAAAAAFBU9PT09Fj0WFRUVFRUVEhISAAAAAAAAAAAAABUAAAAAAAAAABQUExMTEhISExQWPRUVFhUAAAAAExISEhIUFBQVFRMAAAAAAAAAAAAAEhITFRUWPRQAAAAAAAAAAAAAAAA9PT0WPRYVFRUVFBMTExMTExIAAAAAAAAAAAAAFAAAAAAAAAATExMAFBMTEhYVFRY9FRUUAAAAABMTEhMTFBQWFQAAAAAAAAAAAAAAAAATExYWFhUAAAAAAAAAAAAAAAAAFj0VFhUVFhUUExISExMTExMTEgAAAAAAAAAAABYAAAAAAAAVFBQAABITFRMWFRYVPRQUAAAAABMSExMTFhQVFRQAAAAAAAAAAAAAAAAAABITFhUVFAAAAAAAAAAAAAAAAAAUFhUVFBQTExMSEhISExMTEgAAAAAAAAAAAAAAAAAAAAAAFBQSABYTExYVFhYVFRYUAAAAAAAWExQUFBUWFhUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASExIAAAAAAAAAAAAAAAAAAAAAABQAAAAVFhQ9FRYWFRUVAAAAAAAAFRQUFBUVFhUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABISAAAAAAAAAAAAAAAAAAAAAAATAAAVFRYWPRY9PRUVFQAAAAAAABYVPRUWFRQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAPRYWPT0WFhYVFAAAAAAAAAAWFj0VFhQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD09Fj09FhUUEwAAAAAAAAAAFRQVPRQSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA9FhUVFRMTEgAAAAAAAAAAAAASExMUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD0TExQTEgAAAAAAAAAAAAAAAAASEgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAExMTEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"});

  const AFTERIMAGE_BRUSHES = Object.freeze({"ミ":[0,0,0,496,4032,3072,0,496,4032,1024,0,504,4032,7168,0,0],"ナ":[0,0,0,384,384,384,16380,8188,384,384,192,224,112,56,0,0],"ト":[0,0,0,48,48,48,48,240,1008,1840,1072,48,48,48,0,0],"キ":[0,0,64,192,2240,4064,508,128,7552,8176,508,384,256,256,256,0],"オ":[0,0,0,1536,1536,16380,8184,1920,1984,1760,1648,1564,1548,1536,0,0],"ク":[0,0,128,128,8128,8160,6240,2104,3096,1536,1792,896,448,112,0,0],"残":[0,0,3584,6780,16280,2008,15992,4076,15918,16382,13360,7184,28184,31692,12484,0],"像":[0,0,400,4056,1640,16380,13180,16366,14286,16380,4092,7164,14284,26364,924,0]});

  const AFTERIMAGE_STENCILS = Object.freeze({
    '0': [' ### ', '## ##', '## ##', '## ##', ' ### '],
    '1': [' ##  ', '###  ', ' ##  ', ' ##  ', '#### '],
    '3': ['#### ', '   ##', ' ### ', '   ##', '#### '],
    '4': ['## ##', '## ##', '#####', '   ##', '   ##'],
    '7': ['#####', '   ##', '  ## ', ' ##  ', ' ##  '],
    mark: ['   #   ', '  # #  ', ' #   # ', '#  #  #', ' #   # ', '  # #  ', '   #   '],
    arrow: ['    #  ', '     # ', '#######', '     # ', '    #  ']
  });

  function afterimageTowerBands(kind) {
    return kind === 'louver' ? [.32,.67,1] : [.58,1];
  }

  function growAfterimageHarbor(B, S, { seed, planters, ridge, land, ford, towers, trees, trunk }) {
    const K = KIT, G = K.grow, V = K.V;
    const beds = planters.flatMap(([x, z, y]) => [
      { box: [x-.31, x+.31, z-.14, z+.14], y: y+.235, count: 5, gap: .18, kind: 'flowers', size: [.74,1.12] },
      { box: [x-.30, x+.30, z-.13, z+.10], y: y+.235, count: 2, gap: .25, kind: 'ferns', size: [.68,.88] }
    ]);
    for (const [side, z, offset, width, count] of [
      [-1, 4.13, 2.67, .52, 10], [-1, 5.97, 2.18, .39, 9], [-1, 7.2, 2.15, .55, 12],
      [1, 4.75, 1.93, .53, 10], [1, 6.54, 1.79, .56, 12], [1, 8.03, 1.82, .52, 9],
      [-1, -.85, 2.22, .41, 7], [1, .38, 1.84, .37, 7], [-1, -5.9, 1.75, .48, 7]
    ]) {
      const x = ford(z) + side * offset;
      beds.push({ disc: [x,z,width], count, gap: .19, kind: 'grass', size: [.65,1.30] });
    }
    for (const [x, z, y, radius] of [[-4.23, 5.45, .45, .25], [-5.88, 2.15, .70, .27],
      [3.26, 4.03, .60, .28], [-3.84, 7.01, .45, .23]]) {
      beds.push({ disc: [x,z,radius], y, count: 3, gap: .22, kind: 'flowers', size: [.53,.78] });
      beds.push({ disc: [x,z,radius], y, count: 1, kind: 'ferns', size: [.68,.88] });
    }
    for (const [index, side, row] of [[11,1,.32], [1,-1,.31], [17,1,.29]]) {
      const [x,y0,z,w,h,d] = towers[index];
      const y = Math.max(y0,ridge(x,z)-.08)+h;
      beds.push({ disc: [x+side*w*.30,z+d*row,.23], y: y+.007, count: 3, gap: .16, kind: 'grass', size: [.51,.69] });
    }
    const cracks = [
      [-8.61,.69,5.06], [-8.82,.69,5.45], [-5.54,.69,6.64], [-5.79,.69,7.17],
      [-4.34,.46,6.84], [-4.46,.52,3.81], [-5.94,.71,2.08], [-6.48,.86,-1.18],
      [4.51,.69,5.31], [4.79,.69,5.70], [4.18,.70,6.35], [3.40,.65,3.93],
      [7.12,.66,4.15], [7.96,.66,5.34]
    ];
    const walls = [];
    // A vine crosses the sill on its outward face. Each runner has a root at
    // a rain gutter, a ledge or the foot of a wall.
    for (const [index, across, base, drift, direction, steps, side] of [
      [15, .32, .99, -.24,-1, 32, false], [15,-.31,.61,.36,-1,18,false],
      [14,.24,.18,.38,1,22,false], [11,.33,.99,-.25,-1,32,false],
      [11,-.24,.29,.14,1,23,true], [13,.33,.28,-.37,1,14,false],
      [4,-.29,.98,.22,-1,21,false], [17,-.31,.30,.21,1,12,false]
    ]) {
      const [x,y0,z,w,h,d,kind] = towers[index];
      const y = Math.max(y0,ridge(x,z)-.08);
      const plane = side ? x-w*.5 : z+d*.5, bands = afterimageTowerBands(kind);
      const bandReach = v => {
        let reach = 0;
        for (const band of bands) {
          const t = Math.max(0,1-Math.abs(v-(y+h*band-.05))/.148);
          reach = Math.max(reach,.103*t*t*(3-2*t));
        }
        return reach;
      };
      const surface = side ? (u,v) => plane-u-bandReach(v) : (u,v,k) => k-plane-bandReach(v);
      const from = side ? [plane,y+h*base,z+d*across] : [x+w*across,y+h*base,plane];
      const dir = side ? [0,direction,drift] : [drift,direction,0];
      const stop = (p) => p[1] < y+.21 || p[1] > y+h+.01 ||
        (side ? Math.abs(p[2]-z) > d*.49 : Math.abs(p[0]-x) > w*.49);
      walls.push({ from, dir, steps, surface, stop });
    }

    const graph = K.procedural.graph.create({
      inputs: { beds: 'points', walls: 'points', trees: 'points', cracks: 'points' },
      nodes: {
        rooted: { op: 'plantOnBeds', inputs: { beds: { input: 'beds' } } },
        grasses: { op: 'plantKind', inputs: { sites: { node: 'rooted' }, kind: { value: 'grass' } } },
        flowers: { op: 'plantKind', inputs: { sites: { node: 'rooted' }, kind: { value: 'flowers' } } },
        ferns: { op: 'plantKind', inputs: { sites: { node: 'rooted' }, kind: { value: 'ferns' } } },
        creepers: { op: 'followFacade', inputs: { walls: { input: 'walls' } } },
        crowns: { op: 'crownBranches', inputs: { trees: { input: 'trees' } } },
        moss: { op: 'spreadOnStone', inputs: { cracks: { input: 'cracks' } } }
      },
      outputs: {
        grass: { node: 'grasses' }, flowers: { node: 'flowers' }, ferns: { node: 'ferns' },
        creepers: { node: 'creepers' }, crowns: { node: 'crowns' }, moss: { node: 'moss' }
      }
    }, { operations: {
      plantOnBeds: {
        inputs: { beds: 'points' }, outputs: { value: 'points' },
        run({ beds }, context) {
          const surface = {
            ready() {}, sun: S.sun, heightAt: ridge,
            sdf: (x,y,z) => y-ridge(x,z)
          };
          return { value: beds.flatMap(({ y, count, kind, ...patch }, i) => {
            const bed = y === undefined ? surface : { ...surface, heightAt: () => y, sdf: (x,h) => h-y };
            return G.scatter(bed, {
              ...patch, n: count, gap: patch.gap ?? .23, slope: [.83,1],
              where: y === undefined ? ((x,z) => land(x,z) < -.13 ? .9 : 0) : undefined,
              seed: context.seed + i * 431
            }).map(site => ({ ...site, kind }));
          }) };
        }
      },
      plantKind: {
        inputs: { sites: 'points', kind: 'string' }, outputs: { value: 'points' },
        run: ({ sites, kind }) => ({ value: sites.filter(site => site.kind === kind) })
      },
      crownBranches: {
        inputs: { trees: 'points' }, outputs: { value: 'points' },
        run({ trees }, context) {
          return { value: trees.map(([x,y,z,height,width,kind,[dx,dz]],i) => {
            const willow = kind === 'willow', root = [x,y,z];
            const collar = [x+dx*.46,y+height*.49,z+dz*.46];
            const center = [x+dx,y+height*(willow ? .88 : .84),z+dz];
            const form = K.form.colonize({
              at: collar, crown: { c: center,r: [width,height*(willow ? .23 : .32),width*.76] },
              up: [dx*.84,1,dz*.84], n: willow ? 82 : 71, step: .093, influence: .63, kill: .135,
              trunk: .135+height*.09, r: .009, seed: context.seed+i*137, maxNodes: 280
            });
            return { root,collar,center,form,kind,width,height };
          }) };

        }
      },
      spreadOnStone: {
        inputs: { cracks: 'points' }, outputs: { value: 'points' },
        run: ({ cracks }, context) => ({ value: G.spread(S, {
          from: cracks, steps: 5, gap: .099, chance: .64, tries: 4, seed: context.seed,
          ok: (x,y,z,n) => n[1] > -.14 && y > .32 && y < 1.04
        }).pts })
      },
      followFacade: {
        inputs: { walls: 'points' }, outputs: { value: 'points' },
        run: ({ walls }, context) => ({ value: walls.map(({ surface,...wall },i) =>
          G.creep({ ready() {}, sdf: surface }, {
            ...wall, step: .103, hug: .033, wander: .66, every: 2, branch: .085, depth: 1,
            seed: context.seed + i * 1009
          })) })

      }
    } });
    const { outputs } = graph.evaluate({ beds, walls, trees, cracks }, { seed });

    const up = [0,1,0], { P } = B;
    const blade = [24,58,55,26], paleBlade = [58,55,27,63];
    const outerPetal = [38,39,40,42], innerPetal = [38,39,40,21];
    const wind = (p, yaw, rg, sp) => ({ k: 14, ex: p[1], ph: yaw, rg, sp });

    // A strip needs only one row of oriented marks. Shape, taper and tone
    // come from the curve, so the stalks keep their silhouette at pixel scale.
    function ribbon(target, base, control, tip, width, normal, ramp, steps, motion) {
      const length = V.dist(base,control) + V.dist(control,tip);
      for (let i = 0; i < steps; i++) {
        const t = (i+.5)/steps;
        const left = V.lerp(base,control,t), right = V.lerp(control,tip,t), at = V.lerp(left,right,t);
        const tangent = V.norm(V.sub(right,left));
        const facing = V.norm(V.cross(tangent,V.cross(normal,tangent)));
        const w = width*(.24+.78*Math.sin(Math.PI*t))*(1-.53*t*t);
        const tone = ramp[Math.min(ramp.length-1, Math.floor(t*ramp.length))];
        target.dab(...at,facing,tangent,length/steps*.48,w,.008,P[tone],2.35,motion);
      }
    }
    function stalk(target, start, end, width, color, motion, maxStep = .14) {
      const delta = V.sub(end,start), length = V.len(delta), count = Math.ceil(length/maxStep);
      const tangent = V.norm(delta);
      for (let j = 0; j < count; j++) {
        const at = V.mad(start,delta,(j+.5)/count);
        target.stick(...at,tangent,length/count*.48,width,P[color],2.2,motion);
      }
    }

    G.species({
      name: 'harbor-sedge', seed: seed + 131, vary: { height: [.31,.59], fan: [.19,.32] },
      make(target, root, { height, fan, rnd }, scale, site) {
        const motion = wind(root,site.yaw,.078,1.46);
        for (let i = 0; i < 6; i++) {
          const a = site.yaw+i*2.399+rnd()*.39, x = Math.cos(a), z = Math.sin(a);
          const h = height*scale*(.55+rnd()*.57), lean = fan*scale*(.56+rnd()*.51);
          ribbon(target,V.add(root,[x*.028,-.015,z*.028]),V.add(root,[x*lean*.25,h*.65,z*lean*.25]),
            V.add(root,[x*lean,h,z*lean]), (.021+rnd()*.012)*scale,[x,.18,z],
            i%3 ? blade : paleBlade,5,motion);
        }
      }
    }).sow(B, outputs.grass);

    G.species({
      name: 'harbor-ladder-fern', seed: seed + 263, vary: { height: [.35,.53], spread: [.39,.55] },
      make(target, root, { height, spread, rnd }, scale, site) {
        const motion = wind(root,site.yaw,.067,1.23);
        for (let k = 0; k < 5; k++) {
          const a = site.yaw+k*2.399+rnd()*.31, x = Math.cos(a), z = Math.sin(a);
          const h = scale*height*(.73+rnd()*.51), reach = scale*spread*(.66+rnd()*.44);
          const arc = t => V.add(root,[x*reach*t*t,h*Math.sin(t*2.10)-.021,z*reach*t*t]);
          let before = arc(0);
          for (let j = 1; j <= 5; j++) {
            const at = arc(j/5);
            stalk(target,before,at,.011*scale,26,motion);
            before = at;
          }
          for (let j = 0; j < 4; j++) {
            for (const side of [-1,1]) {
              const base = arc(.40+j*.165+side*.026), w = (.136-j*.021)*side*scale, out = (.106-j*.012)*scale;
              const tip = V.add(base,[z*w+x*out,(.041-j*.011)*scale,-x*w+z*out]);
              ribbon(target,base,V.add(V.lerp(base,tip,.51),[0,.033*scale,0]),tip,
                (.031-j*.004)*scale,up,k%3 ? blade : paleBlade,3,motion);
            }
          }
        }
      }
    }).sow(B,outputs.ferns);

    G.species({
      name: 'harbor-vermilion-iris', seed: seed + 389, vary: { height: [.34,.65], size: [.15,.222], tilt: [.34,.69] },
      make(target, root, { height, size, tilt }, scale, site) {
        const x = Math.cos(site.yaw), z = Math.sin(site.yaw), h = height*scale;
        const motion = wind(root,site.yaw,.065,1.15);
        const head = V.add(root,[x*h*.19,h,z*h*.19]);
        stalk(target,V.add(root,[0,-.025,0]),head,.012*scale,26,motion);
        for (const side of [-1,1]) {
          const base = V.lerp(root,head,side>0 ? .36 : .18);
          ribbon(target,base,V.add(base,[side*z*.12*scale,.15*scale,-side*x*.12*scale]),
            V.add(base,[side*z*.18*scale,.23*scale,-side*x*.18*scale]), .036*scale,
            [x,.27,z],blade,5,motion);
        }
        const axis = V.norm([x*tilt,1,z*tilt]), tangent = V.norm(V.cross(axis,[x,0,z]));
        const bitangent = V.cross(tangent,axis);
        for (const q of G.arrange('rosette',0,{ rings: 2, per: 3, r: size*scale, open: .97 })) {
          const dir = V.add(V.add(V.mul(tangent,q.dir[0]),V.mul(axis,q.dir[1])),V.mul(bitangent,q.dir[2]));
          const inner = q.t < .5, length = q.s * (inner ? 1.21 : 1.09);
          const peak = V.mad(V.mad(head,dir,length*.57),axis,.043*scale);
          const tip = V.mad(V.mad(head,dir,length),axis,inner ? .028*scale : -.054*scale);
          ribbon(target,head,peak,tip,length*(inner ? .27 : .36),axis,inner ? innerPetal : outerPetal,5,motion);
          if (!inner) {
            const vein = V.mad(V.lerp(head,peak,.75),axis,.013*scale);
            const veinDir = V.norm(V.cross(axis,V.cross(dir,axis)));
            target.dab(...vein,axis,veinDir,length*.17,.010*scale,.006,P[21],2.3,motion);
          }
        }
        target.disc(...V.mad(head,axis,.023*scale),axis,.028*scale,.009,P[17],2.5,motion);
      }
    }).sow(B,outputs.flowers);

    const rnd = G.dice(seed + 521);
    function leafDab(point, dir, normal, length, width, tone, motion, alpha = 2.15) {
      const facing = V.norm(V.cross(dir,V.cross(normal,dir)));
      B.dab(...point,facing,dir,length,width,.006,P[tone],alpha,motion);
    }
    function shootLeaf(base, tip, normal, width, shade, light, motion) {
      const length = V.dist(base,tip), dir = V.norm(V.sub(tip,base));
      leafDab(V.lerp(base,tip,.37),dir,normal,length*.35,width,shade,motion);
      leafDab(V.lerp(base,tip,.73),dir,normal,length*.26,width*.63,light,motion);
    }
    function blossoms(point, normal, axis, size, phase, motion) {
      const across = V.cross(normal,axis);
      for (let j = 0; j < 5; j++) {
        const at = j*Math.PI*2/5+phase;
        const ray = V.norm(V.add(V.mul(axis,Math.cos(at)),V.mul(across,Math.sin(at))));
        const tip = V.mad(point,ray,size);
        leafDab(V.lerp(point,tip,.72),ray,normal,size*.47,size*.29,j === 0 ? 22 : j%2 ? 42 : 40,motion,1.72);
      }
      leafDab(V.mad(point,normal,.006),axis,normal,size*.23,size*.19,47,motion);
    }
    for (const { root,collar,center,form,kind,width,height } of outputs.crowns) {
      const willow = kind === 'willow';
      const motion = wind(collar,rnd()*Math.PI*2,willow ? .092 : .056,willow ? 1.26 : 1.12);
      const bark = { ...trunk, r: [7,14,43,15,45], s: [14,43,45,58],
        mod: (x,y,z) => .23*Math.sin(x*22+z*16+B.n3(x*5,y*.7,z*5)*4) };
      const bent = V.sub(collar,root);
      const knee = V.mad(V.lerp(root,collar,.48),[bent[2],0,-bent[0]],.55);
      const bough = B.spline([V.add(root,[0,-.06,0]),knee,collar],4);
      S.tube(bough,width*.128,width*.080,bark,{ res: .041 });
      G.limbs(S,form,{ ...bark,fl: motion },{ res: .051,melt: .017 });
      for (let i = 0; i < 4; i++) {
        const a = i*2.399+motion.ph, reach = width*(.24+rnd()*.25);
        const end = V.add(root,[Math.cos(a)*reach,-.026,Math.sin(a)*reach]);
        S.tube([V.add(root,[0,width*.19,0]),V.add(V.lerp(root,end,.57),[0,.022,0]),end],
          width*.050,.011,bark,{ res: .051 });
      }
      for (const twig of form.tips) {
        const side = V.norm(V.cross(twig.dir,[.12,1,.08]));
        const bloom = kind === 'flowering' && rnd() < .29;
        const h = (twig.p[1]-center[1])/height;
        for (let spray = 0; spray < 2; spray++) {
          const skew = spray ? -.78 : .62;
          const out = V.norm(V.add(twig.dir,V.mul(side,skew)));
          const reach = width*(.29+rnd()*.30)*(spray ? .83 : 1);
          const fall = width*(willow ? .21+rnd()*.44 : .02+rnd()*.16);
          const arc = t => V.add(V.mad(twig.p,out,t*reach),[0,.09*reach*Math.sin(Math.PI*t)-fall*t*t,0]);
          let prev = twig.p;
          for (let i = 1; i <= 4; i++) {
            const p = arc(i*.25);
            stalk(B,prev,p,.012-i*.0013,i < 3 ? 24 : 58,motion);
            prev = p;
          }
          const phase = rnd()-.5;
          for (let i = 0; i < 6; i++) {
            const t = .13+i*.145, at = arc(t);
            const lateral = V.norm(V.cross(V.sub(arc(t+.04),at),[.09,1,.14]));
            const sign = i%2 ? -1 : 1, size = width*(.19+rnd()*.15)*(1-t*.41);
            const tangent = V.norm(V.add(V.mul(out,willow ? .38 : .56),V.mul(lateral,sign)));
            const drop = size*(willow ? .51+t*.38 : .14+phase);
            const tip = V.add(V.mad(at,tangent,size),[0,-drop,0]);
            const facing = V.norm(V.add([phase,.45,sign*.84],V.mul(side,phase)));
            const lit = V.dot(facing,S.sun) + .19*(rnd()-.5) + h*.54;
            const body = lit > .38 ? 55 : lit > -.28 ? 54 : 58;
            const edge = lit > .65 && i%3 !== 1 ? 63 : lit > .22 ? 55 : body;
            shootLeaf(at,tip,facing,size*(willow ? .145 : .245),body,edge,motion);
            if (bloom && (i === 2 || (i === 4 && !spray))) {
              const n = V.norm([phase,.85,sign*.66]);
              const axis = V.norm(V.cross(n,side));
              blossoms(V.add(at,[sign*.033,.027,.018]),n,axis,.036+rnd()*.018,rnd(),motion);
            }
          }
        }
      }
    }
    for (const p of outputs.moss) {
      const [x,y,z] = p, eps = .015;
      const n = V.norm([S.sdf(x+eps,y,z)-S.sdf(x-eps,y,z),S.sdf(x,y+eps,z)-S.sdf(x,y-eps,z),
        S.sdf(x,y,z+eps)-S.sdf(x,y,z-eps)]);
      const u = V.norm(V.cross(n,[.087,.31,.95])), size = .032+rnd()*.054;
      const tone = p.step < 3 ? [58,55,26,55] : [23,58,55,26];
      leafDab(V.mad(p,n,.013),u,n,size,size*(.60+.34*rnd()),tone[p.step%tone.length],null,1.37);
    }
    function paintIvy(base, tip, normal, shade, edge) {
      const length = V.dist(base,tip), axis = V.norm(V.sub(tip,base));
      const side = V.norm(V.cross(normal,axis));
      const shoulder = V.lerp(base,tip,.34);
      for (const sign of [-1,1]) {
        const lobe = V.norm(V.add(V.mul(axis,.88),V.mul(side,sign*.50)));
        const p = V.mad(shoulder,side,length*.17*sign);
        leafDab(p,lobe,normal,length*.37,length*.235,shade,null);
      }
      leafDab(V.lerp(base,tip,.67),axis,normal,length*.29,length*.21,edge,null);
      if (edge !== shade)
        leafDab(V.mad(V.lerp(base,tip,.43),normal,.007),axis,normal,length*.18,.006,55,null,1.37);
    }
    for (const vine of outputs.creepers) {
      for (const path of vine.paths) {
        for (let i = 1; i < path.length; i++)
          stalk(B,path[i-1],path[i],.011+(1-i/path.length)*.009,i%4 ? 58 : 55,null);
      }
      for (const { p,n,dir,t,depth,k } of vine.nodes) {
        const side = V.norm(V.cross(n,dir)), sign = (k>>1)%2 ? -1 : 1;
        const root = V.mad(p,n,.013);
        for (let leaf = 0; leaf < (depth ? 1 : 2); leaf++) {
          const size = (.100+rnd()*.105)*(1-t*.25)*(leaf ? .69 : 1);
          const sideSign = leaf ? -sign : sign, extent = sideSign*(.047+rnd()*.042);
          const base = V.mad(V.mad(V.mad(root,side,extent),dir,.034),n,.013);
          const tip = V.mad(V.mad(V.mad(base,side,sideSign*size*.77),dir,size*(leaf ? -.42 : .58)),n,.019);
          stalk(B,root,base,.008,58,null);
          const light = rnd();
          const shade = light > .72 ? 55 : light > .31 ? 54 : 58;
          const edge = light > .86 && leaf ? 63 : light > .40 ? 55 : 54;
          paintIvy(base,tip,n,shade,edge);
        }
      }
    }
  }

  function afterimageWater() {
    const TAU = Math.PI * 2;
    const smooth = (a, b, x) => {
      const u = Math.max(0, Math.min(1, (x - a) / (b - a)));
      return u * u * (3 - 2 * u);
    };
    const waterY = -.34;
    const ford = z => -2.18 + .39 * z + .65 * Math.sin(z * .27 + .45);
    const channel = (x, z) => Math.abs(x - ford(z)) - (1.32 + .76 * Math.exp(-((z - 2.27) ** 2) / 16.5));
    const duration = 18.4;
    const landing = (x, z) => 1 - smooth(.62,1.58,Math.hypot((x-ford(z)+.84)*1.36,(z-4.58)*1.22));
    return { TAU, smooth, waterY, ford, channel, duration, landing };
  }

  const HARBOR_MIRROR = 'harbor-canal-reflection';

  const HARBOR_WATER = 'harbor-canal';

  const HARBOR_WATER_OPTICS = { tint: [.084,.112,.146], deepTint: [.030,.058,.093],
    extinction: [1.12,.50,.30], depthRange: [.16,.93], surfaceColor: [.047,.083,.134],
    surface: 0, refraction: .64, caustics: .18 };

  function afterimageOptics() {
    return [
      { select: { medium: HARBOR_WATER, mediumKind: 'water' }, weight: .94, stack: {
        name: 'Blue-green canal transmission',
        steps: [{ type: 'channelMix', matrix: [[.23,.025,0],[0,1.20,.29],[0,.26,1.13]], offset: [0,.143,.10] }]
      } },
      { select: { medium: HARBOR_MIRROR, mediumKind: 'reflection' }, weight: .86, stack: {
        name: 'Rain-broken neon',
        steps: [{ type: 'channelMix', matrix: [[1.25,.02,0],[0,1.02,.12],[.005,.11,1.15]] },
          { type: 'saturation', factor: 1.52 }]
      } }
    ];
  }

  function afterimageWetGrade(channel, noise, seed, smooth, lanterns) {
    const spill = lanterns.map(p => [...p,1.65]).concat([
      [-7.02,3.65,-.68,3.0], [-6.63,2.0,5.94,2.1], [-9.46,5.3,-4.47,2.3]
    ]);
    const ground = (x,y,z) => smooth(-.34,.56,channel(x,z)) * (1-smooth(1.24,4.65,y));
    return SpatialGrade.bake({ min: [-15,-.8,-12], max: [15,11,12], size: [60,28,48] }, {
      stone: (x,y,z) => ground(x,y,z) * (.66 + .34*smooth(.24,.74,noise(x*.58,z*.65,seed%71))),
      runoff: (x,y,z) => {
        const distance = channel(x,z), low = 1-smooth(.93,3.55,y);
        const wet = smooth(-.26,.38,distance) * (1-smooth(.75,5.8,distance));
        const grain = .27+.73*smooth(.28,.74,noise(x*1.65+z*.16,y*.27+z*.61,seed%37));
        const drain = (1-smooth(.53,1.5,Math.abs(y-1.07)))*.16;
        return low * wet * grain + ground(x,y,z)*drain;
      },
      amber: (x,y,z) => {
        let light = 0;
        for (const [lx,ly,lz,radius] of spill) {
          const d2 = ((x-lx)*.93)**2+((y-ly)*.83)**2+((z-lz)*.90)**2;
          if (d2 < radius*radius) light = Math.max(light,1-smooth(.16,1,d2/(radius*radius)));
        }
        return light * (1-smooth(3.4,7.2,y)) * smooth(-.29,.72,channel(x,z));
      }
    });
  }

  function afterimageRenderStages() {
    return [
      { stage: 'material', select: { material: 'harbor-painted-steel' }, stack: {
        name: 'Indigo enamel',
        steps: [{ type: 'channelMix', matrix: [[.69,.04,.04],[.02,.85,.13],[.03,.17,1.18]],
          offset: [.005,.012,.031] }]
      } },
      { stage: 'lit', select: { material: 'harbor-lantern-paper' }, stack: {
        name: 'Honey through paper',
        steps: [{ type: 'channelMix', matrix: [[.97,.045,0],[.22,1.07,.05],[.12,.14,.62]] },
          { type: 'curves', curves: { channels: {
            red: { stops: [[0,0],[.25,.25],[.69,.81],[1,1]] },
            green: { stops: [[0,0],[.20,.16],[.51,.50],[1,.96]] }
          } } }]
      } },
      { stage: 'lit', select: { material: 'harbor-market-glass' }, weight: .86, stack: {
        name: 'Cyan anti-reflective coating',
        steps: [{ type: 'channelMix', matrix: [[.42,.03,.01],[.06,1.16,.25],[.015,.16,1.18]],
          offset: [0,.24,.27] }]
      } },
      { stage: 'lit', select: { material: 'harbor-market-instrument' }, weight: .75, stack: {
        name: 'Vermilion instrument enamel',
        steps: [{ type: 'channelMix', matrix: [[1.18,.13,0],[.02,.73,.085],[.01,.055,.83]] }]
      } },
      { stage: 'lit', select: { material: 'harbor-projector-coat' }, weight: .62, stack: {
        name: 'Teal courier projection',
        steps: [{ type: 'channelMix', matrix: [[.58,.025,.01],[.025,1.04,.18],[.015,.13,.94]] }]
      } },
      { stage: 'lit', select: { material: 'harbor-vermilion-phosphor' }, weight: .65, stack: {
        name: 'Vermilion phosphor',
        steps: [{ type: 'channelMix', matrix: [[1.08,.025,0],[.018,.91,.04],[.025,0,.87]] }]
      } },
      { stage: 'lit', select: { material: 'harbor-cyan-phosphor' }, weight: .62, stack: {
        name: 'Cyan phosphor',
        steps: [{ type: 'channelMix', matrix: [[.79,.05,0],[0,1.03,.09],[0,.06,1.01]] }]
      } },
      { stage: 'frame', order: 10, weight: .64, mask: SpatialGrade.mask('stone'), stack: {
        name: 'Quay stone',
        steps: [{ type: 'channelMix', matrix: [[1.12,.13,.027],[.034,1.08,.021],[.025,.072,.86]] },
          { type: 'curves', curves: { channels: {
            red: { stops: [[0,0],[.072,.105],[.21,.265],[.51,.54],[1,1]] },
            green: { stops: [[0,0],[.10,.119],[.31,.338],[1,1]] }
          } } }]
      } },
      { stage: 'frame', order: 20, weight: .78, mask: SpatialGrade.mask('runoff'), stack: {
        name: 'Canal runoff',
        steps: [{ type: 'channelMix', matrix: [[.56,.061,.024],[.016,.94,.14],[.015,.15,1.055]] },
          { type: 'curves', curves: { channels: {
            red: { stops: [[0,0],[.11,.079],[.34,.30],[1,1]] },
            blue: { stops: [[0,0],[.13,.159],[.31,.372],[1,1]] }
          } } }]
      } },
      { stage: 'frame', order: 30, weight: .72, mask: SpatialGrade.mask('amber'), stack: {
        name: 'Lantern spill',
        steps: [{ type: 'channelMix', matrix: [[1.23,.42,.125],[.095,.97,.094],[.027,.075,.72]] },
          { type: 'curves', curves: { channels: {
            red: { stops: [[0,0],[.08,.113],[.23,.314],[.53,.63],[1,1]] },
            green: { stops: [[0,0],[.14,.156],[.39,.438],[1,1]] }
          } } }]
      } },
      { stage: 'frame', order: 40, weight: .81, stack: {
        name: 'Blue-hour finish',
        steps: [{ type: 'curves', curves: { channels: {
          red: { stops: [[0,0],[.09,.075],[.28,.28],[.67,.74],[1,1]] },
          green: { stops: [[0,0],[.09,.105],[.28,.32],[.69,.73],[1,1]] },
          blue: { stops: [[0,0],[.09,.12],[.33,.37],[.68,.72],[1,1]] }
        } } }, { type: 'saturation', factor: 1.075 }]
      } },
      { stage: 'palette', palette: {
        palette: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,25,26,28,29,30,
          31,32,33,34,35,36,39,40,41,42,45,46,52,54,55,58,61,63,'#ffc46d','#ffebba'],
        reserved: [62], dither: { pattern: 'bayer', strength: .52 }
      } }
    ];
  }

  function sceneAfterimageHarbor(seed) {
    const K = KIT, B = makeBuilder(seed, [
      0x000000, 0x0a111c, 0x0d1e2d, 0x102b3a, 0x174350, 0x215f70, 0x3b8e9b,
      0x0b101a, 0x151e2d, 0x243044, 0x343f53, 0x465064, 0x646b79, 0x8c8b96,
      0x201018, 0x381923, 0x58202c, 0x872331, 0xbf302c, 0xeb372b, 0xff4939, 0xff793f, 0xffb389,
      0x0c1b25, 0x112835, 0x163747, 0x1c4c5a, 0x286471, 0x438491, 0x6faab0,
      0x121f35, 0x193552, 0x205474, 0x218eac, 0x2abdd9, 0x28e9ff, 0xb0f9ff,
      0x301120, 0x521526, 0x9e1b37, 0xdb2945, 0xff4768, 0xff764c,
      0x161620, 0x20222e, 0x361f2a, 0x512632, 0x7a383d,
      0x0b1521, 0x102334, 0x173345, 0x235466, 0x3f7380,
      0x192b3b, 0x355447, 0x4c705d, 0x73545a, 0x070914, 0x080f1a, 0x223e34,
      0x5bcdff, 0x7ef5ff, 0xe7ffff, 0x879d74
    ]);
    const S = K.sculpt(makeSculpt(B)), { P, norm, n3, rr, TAU } = B, { V } = K;
    const Y = [0, 1, 0], X = [1, 0, 0], Z = [0, 0, 1], light = { em: true };
    const dimLight = { em: true, nd: true };
    const lights = [], sails = [];
    const { smooth, waterY, ford, channel, landing } = afterimageWater();
    const coast = (x, z) => {
      const a = Math.atan2((z + .12) * 1.21, x + .38);
      return Math.hypot(x + .38, (z + .12) * 1.21) - (13.1 + .84 * Math.cos(3 * a + .6) + .53 * Math.sin(5 * a));
    };
    const ridge = (x, z) => {
      const base = .32 + .32 * smooth(2.0, 7.0, -z) + .21 * smooth(-.6, 4.5, x);
      return waterY + .08 + (base - waterY - .08) * smooth(-.05, .92, Math.min(channel(x, z), -coast(x, z)));
    };
    const land = (x, z) => Math.max(coast(x, z), -channel(x, z));
    const normal = p => norm(p);
    S.pixel = true;
    S.captureAlbedo = true;
    S.pixelSize(17);
    S.sun = normal([-.56, .62, .55]); S.sunK = .48; S.amb = .14; S.sky = .105;
    S.shLen = 5; S.aoK = .43; S.wob = .035;

    const concrete = K.pixel.masonry({ r: [7, 8, 9, 10, 11, 12], stone: [12, 6], vary: .26, seed: 39 });
    const slate = K.pixel.tiles({ r: [1, 3, 4, 5, 6], tile: [9, 6], seed: 66 });
    const bronze = K.pixel.masonry({ r: [14, 15, 16, 17, 45, 46], stone: [11, 5], vary: .45, seed: 80 });
    const paving = K.pixel.masonry({ r: [7, 8, 43, 44, 10], stone: [12, 10], joint: 1, vary: .69, seed: 18 });
    const black = { r: [0, 1, 7, 8] }, steel = 'harbor-painted-steel';
    const eave = { r: [7, 9, 10, 11, 46], materialId: steel, albedo: 11 };
    const iron = { r: [7, 8, 9, 10, 11], materialId: steel }, foil = { r: [23, 30, 31, 32, 33, 34] };
    const ochre = { r: [16, 17, 18, 19, 20] }, amber = { r: [18, 19, 20, 21, 22], em: true };
    const jade = { r: [26, 28, 35, 60, 61], em: true };
    const trunk = { r: [7, 14, 15, 16, 43, 45] };
    const groundCover = K.pixel.edge(K.pixel.turf({
      r: [7, 23, 24, 25, 53, 54], clump: 8, patch: 1.49, tufts: .24, clumps: .3,
      flowers: [[20, .055, 19], [40, .046, 38], [35, .024, 34]], seed: 63
    }), { up: 'grass', every: 6, share: .42 });
    const cliff = K.pixel.rock({ r: [1, 7, 8, 9, 10, 11], seed: 101 });
    const leafWarm = K.pixel.edge({ r: [37, 38, 39, 40, 41, 19, 20],
      fl: { k: 11, ph: 1, sp: 1.9, rg: .021 } }, { up: 'leafy', side: 'leafy', every: 6, share: .60 });
    const leafCold = K.pixel.edge({ r: [23, 24, 25, 26, 27, 28],
      fl: { k: 11, ph: 2, sp: 1.6, rg: .017 } }, { up: 'leafy', side: 'leafy', every: 6, share: .49 });

    function block(x, y, z, width, height, depth, material, res = .14, rd = .038) {
      // Diffuse panels use a lower sampling density. Direct-paint pixels and
      // working fittings retain their own resolution.
      return S.box([x, y + height * .5, z], [width * .5, height * .5, depth * .5], material,
        { res: res * (res >= .10 ? 1.48 : 1.12), rd });
    }
    function rod(a, b, r, material, res = .076) {
      return S.tube([a, b], r, r, material, { res });
    }
    function line(a, b, r, col, alpha = 2.1, flags = light) {
      const delta = V.sub(b, a), length = V.len(delta), dir = V.mul(delta, 1 / Math.max(.001, length));
      const n = Math.max(1, Math.ceil(length / Math.max(.052, r * 2.7)));
      for (let i = 0; i < n; i++) B.stick(...V.mad(a, delta, (i + .5) / n), dir,
        length / n * .58, r, P[col], alpha, flags);
    }
    function torus(x, y, z, radius, width, material, res = .083) {
      return S.torus([x, y, z], radius, width, material, { res });
    }

    // Water is a restrained dark mass, with broken stroke clusters close to piers.
    const bayer4 = [0,8,2,10, 12,4,14,6, 3,11,1,9, 15,7,13,5];
    const waterStart = B.count();
    for (let z = -12.55; z < 12.65; z += .195) {
      for (let x = -15.3; x < 15.4; x += .195) {
        const edge = coast(x * .86, z * .894) + .32 * Math.sin(z * 1.45 + .8);
        if (edge > .02 || (land(x, z) < -.26 && edge < -1)) continue;
        const wave = n3(x * .39 + 9, z * 1.4, 19);
        const reflection = Math.exp(-((x - ford(z) + .42) ** 2) / .79);
        const rank = bayer4[(Math.floor(x / .195) & 3) + ((Math.floor(z / .195) & 3) << 2)] / 16 - .5;
        const grain = wave + rank * .33;
        const tone = grain > .68 ? 49 : grain > .42 ? 48 : 57;
        const ink = reflection * wave > .63 && z < 3.9 ? 4 : tone;
        const cover = edge < -.95 ? 2.63 : .8 + 1.8 * smooth(.02, .96, -edge);
        const open = smooth(-.19,1.44,-channel(x,z));
        const canalCover = cover + (.46-cover) * open;
        const a = canalCover + (.077-canalCover) * landing(x,z);
        B.dab(x, waterY, z, Y, X, .132, .128, .015, P[ink], a, { em: true, k: 10, ph: .7, sp: .54, rg: .026 });
      }
    }
    const waterEnd = B.count(), bedStart = B.count();
    // Painted service treads descend from the quay into the canal.
    for (let step = 0; step < 5; step++) {
      const z = 4.58, x = ford(z)-1.13 + step*.239, y = waterY-.076-step*.154;
      for (let strip = 0; strip < 13; strip++) {
        const zz = z + (strip-6)*.083, end = strip < 2 || strip > 10;
        for (let tread = 0; tread < 3; tread++) {
          const ink = tread === 0 ? (end ? 22 : 29) : (strip+tread)%5 === 0 ? 13 : 11;
          B.dab(x+(tread-1)*.072,y,zz,Y,X,.046,.052,.012,P[ink],1.61,light);
        }
        B.dab(x+.120,y-.056,zz,X,Y,.054,.053,.012,P[31],1.58,light);
      }
    }
    const bedEnd = B.count();

    S.terrain({
      r: [7, 8, 9, 43, 44], top: Object.assign({ min: .65 }, groundCover),
      mod: (x, y, z) => .13 * (n3(x, z, 2) - .5)
    }, { x0: -14, x1: 14, z0: -12, z1: 12, h: ridge, res: .205,
      keep: (x, z) => land(x, z) < -.005 });
    S.bake();
    for (let angle = 0; angle < TAU; angle += .063) {
      const radius = 13.1 + .84 * Math.cos(3 * angle + .6) + .53 * Math.sin(5 * angle);
      const x = -.38 + Math.cos(angle) * radius * .988, z = -.12 + Math.sin(angle) * radius / 1.21;
      if (channel(x, z) < .2) continue;
      const size = .34 + .35 * n3(x, z, 4);
      S.facet({ at: [x, waterY - .18, z], size: [size, size * .85, size * .72], mat: cliff,
        top: angle % .31 < .14 ? leafCold : null, tilt: .32, faces: 7, res: .125, seed: 1000 + Math.round(angle * 100) });
    }

    // Canal walls, paths and moorings follow the curve, with recessed walking terraces.
    for (const side of [-1, 1]) {
      for (let z = -7.65; z < 8.5; z += .59) {
        const wide = 1.32 + .76 * Math.exp(-((z - 2.27) ** 2) / 16.5);
        const x = ford(z) + side * (wide + .24), y = ridge(x + side * .88, z) - .06;
        if (coast(x, z) > -.43) continue;
        const yaw = Math.atan2(.39 + .176 * Math.cos(z * .27 + .45), 1);
        S.box([x, (waterY + y) * .5, z], [.17, (y - waterY) * .5 + .052, .31], concrete,
          { ax: B.frame(yaw, 0, 0), res: .12, rd: .049 });
        if (z < 3.0 || side > 0) {
          const xx = x + side * .60;
          S.box([xx, y -.013, z], [.55, .043, .31], paving,
            { ax: B.frame(yaw, 0, 0), res: .115, rd: .027 });
          if (Math.round(z / .59) % 3 === 1) block(x, y, z, .14, .36, .16, iron, .06);
        }
      }
    }

    const wharves = [
      { x: -7.08, z: 5.75, w: 4.80, d: 4.48, h: .68, wash: bronze },
      { x: 4.9, z: -4.56, w: 7.11, d: 5.30, h: 1.07, wash: concrete },
      { x: -7.18, z: -4.1, w: 8.55, d: 5.9, h: .87, wash: bronze },
      { x: 8.35, z: 3.02, w: 6.19, d: 4.9, h: .65, wash: concrete }
    ];
    wharves.forEach(({ x, z, w, d, h, wash }) => {
      block(x, .19, z, w, h - .16, d, wash, .163, .14);
      block(x, h - .035, z, w + .13, .09, d + .13, paving, .134);
    });

    // The boardwalk bends through leveled planting beds and wet footholds.
    const deck = K.pixel.planks({ r: [7, 14, 15, 43, 45], width: 4, along: 'z', seed: 92 });
    for (const [x, y, z, w, d] of [
      [-8.73, .56, 7.83, 3.48, 1.14], [-6.48, .55, 8.48, 1.46, 1.45],
      [-4.03, .44, 5.48, .93, 4.6], [4.05, .68, 5.68, 3.18, 1.50],
      [3.37, .59, 3.50, 2.04, 1.56], [1.8, .59, .90, 2.56, 1.22],
      [-5.91, .69, 1.11, 2.10, 2.81], [-6.26, .84, -1.69, 2.31, 1.73]
    ]) {
      block(x, y - .07, z, w, .145, d, paving, .108, .065);
      for (const dz of [-d * .49, d * .49])
        rod([x - w * .46, y + .065, z + dz], [x + w * .46, y + .065, z + dz], .027, bronze, .058);
    }
    for (const [x, z, y] of [[-3.11, 5.69, .36], [.96, 7.87, .42], [-5.1, -.94, .78]]) {
      block(x, y, z, .72, .11, .74, deck, .079, .021);
      for (const dx of [-.29,.29]) block(x + dx, waterY - .05, z, .088, y - waterY + .098, .089, iron, .064);
    }
    for (const [l, x, z, stepY] of [[6,-4.92,4.1,.43],[7,-5.2,-1.1,.53],[5,3.46,1.6,.63]]) {
      for (let i = 0; i < l; i++) {
        const p = [x + .21 * i, stepY + .024 * i, z - i * .148];
        S.box(p, [.159, .056, .147], paving, { ax: B.frame(.33, 0, 0), res: .075, rd: .021 });
      }
    }
    const planters = [[-8.54,5.29,.75], [-5.51,6.90,.75], [4.49,5.55,.75], [7.01,3.93,.72]];
    for (const [x, z, y] of planters) {
      block(x, y, z, .77, .244, .41, bronze, .075, .032);
      block(x, y + .207, z, .83, .058, .48, concrete, .069, .035);
    }

    // A rising bridge, unequal piers and cable stays lead the eye to the transmitter.
    function bridge(z, left, right, height) {
      const n = Math.ceil((right - left) / .27), step = (right - left) / n;
      const deck = x => height + .29 * Math.sin(Math.PI * (x - left) / (right - left));
      for (let i = 0; i < n; i++) {
        const x = left + (i + .5) * step, y = deck(x);
        block(x, y - .11, z, step + .015, .15, 1.43, paving, .097);
        for (const dz of [-.647, .647]) if (i % 2 === 0) {
          block(x, y + .025, z + dz, .083, .42, .085, iron, .063);
          if (i % 6 === 0) line([x - .02, y + .06, z + dz], [x + .08, y + .06, z + dz], .022, dz > 0 ? 20 : 35);
        }
      }
      for (const dz of [-.65, .65]) for (let i = 0; i < 16; i++) {
        const a = left + (right - left) * i / 16, b = left + (right - left) * (i + 1) / 16;
        rod([a, deck(a) + .42, z + dz], [b, deck(b) + .42, z + dz], .033, eave, .066);
      }
      for (const x of [left + .55, right - .54]) for (const dz of [-.62, .62]) {
        block(x, waterY - .19, z + dz, .19, height + .31, .20, concrete);
        block(x, deck(x) + .3, z + dz, .21, .58, .21, bronze, .071);
        block(x, deck(x) + .81, z + dz, .16, .18, .16, amber, .053);
        lights.push([x, deck(x) + .84, z + dz, 21]);
      }
    }
    bridge(2.65, ford(2.65) - 3.42, ford(2.65) + 3.93, .95);
    bridge(-5.18, ford(-5.18) - 2.08, ford(-5.18) + 2.14, .92);

    function surfacePaint(origin, right, normal, size, stencil, color, id, up = Y) {
      const width = Math.max(...stencil.map(row => row.length)), height = stencil.length;
      for (let row = 0; row < height; row++) for (let col = 0; col < stencil[row].length; col++) {
        if (stencil[row][col] !== '#' || K.hash(row,col,id) < .115) continue;
        const dx = (col + .5 - width * .5) * size, dy = (height * .5 - row - .5) * size;
        const p = V.mad(V.mad(origin, right, dx), up, dy);
        B.dab(...p, normal, right, size * .55, size * .55, .009, P[color], 1.85, light);
      }
    }
    function facadePaint(x, y, z, w, h, d, id, warm) {
      const ink = warm ? 18 : 33, chalk = warm ? 46 : 51;
      const numbers = ['07', '13', '04', '31'];
      const digits = numbers[id % numbers.length].split('').map(n => AFTERIMAGE_STENCILS[n]);
      const stencil = digits[0].map((row, i) => row + ' ' + digits[1][i]);
      for (const side of [-1, 1]) {
        const fz = z + side * (d * .5 + .106), fx = x + side * (w * .5 + .094);
        surfacePaint([x - .27 * side, y + .68, fz], [side,0,0], [0,0,side], .071, stencil, chalk, id + side);
        if (h > 4) surfacePaint([x + w * .27, y + h * .74, fz], [side,0,0], [0,0,side], .064,
          AFTERIMAGE_STENCILS.mark, ink, id + 73);
        if (id % 3 !== 0) surfacePaint([fx, y + h * .31, z + d * .29], [0,0,-side], [side,0,0], .061,
          AFTERIMAGE_STENCILS.arrow, chalk, id * 6);
        for (let streak = 0; streak < 13; streak++) {
          const u = K.hash(streak, side * 2, id), node = K.hash(streak, 17, id);
          const xx = x + (u - .5) * w * .9, yy = y + h * .16 + h * .76 * node;
          const len = .13 + (u ** 2) * .43;
          for (let tick = 0; tick < 5; tick++) {
            const tone = tick === 0 && node > .7 ? chalk : warm ? 15 : 8;
            B.dab(xx + .014 * tick, yy - tick * len / 5, fz - side * .03, [0,0,side], X,
              .019 + .011 * (1 - node), len / 6, .009, P[tone], 1.29 - tick * .14, light);
          }
        }
      }
    }

    // Buildings share a material vocabulary, and each has its own profile.
    const towers = [
      [-8.62, -.91, -6.05, 2.91, 10.25, 2.51, 'louver', true],
      [-10.2, -.28, -3.08, 2.04, 4.04, 2.46, 'terrace', true],
      [-6.14, .28, -6.52, 2.14, 8.42, 1.92, 'tier', true],
      [-10.15, .15, -.05, 2.55, 2.74, 2.13, 'louver', true],
      [-8.16, .65, -2.78, 2.59, 3.12, 2.20, 'terrace', true],
      [-4.02, .35, -8.83, 2.13, 3.85, 2.31, 'tier', false],
      [-1.53, .58, -8.41, 3.19, 10.62, 2.07, 'louver', false],
      [3.12, .61, -8.35, 2.61, 8.03, 2.32, 'tier', false],
      [7.41, .25, -6.9, 2.36, 7.27, 2.29, 'louver', false],
      [9.49, .44, -4.42, 2.77, 9.68, 2.8, 'tier', false],
      [10.62, .43, -.82, 2.64, 3.97, 2.43, 'terrace', false],
      [8.51, .64, 2.23, 2.68, 4.12, 2.32, 'terrace', false],
      [10.42, .65, 3.78, 2.11, 3.40, 1.68, 'louver', true],
      [5.3, .45, 4.65, 1.85, 1.91, 1.73, 'louver', true],
      [-10.4, .44, 2.29, 1.66, 3.29, 1.45, 'terrace', true],
      [-8.76, .49, 4.39, 1.71, 3.97, 1.60, 'louver', false],
      [5.7, .52, 1.22, 1.51, 2.24, 1.44, 'terrace', false],
      [7.00, .36, 6.91, 1.71, 2.05, 1.62, 'tier', true]
    ];
    const spriteAtlas = globalThis.INK_SPRITE_SURFACES && typeof SpriteSurface !== 'undefined' ? SpriteSurface.make() : null;
    const rgbHex = P.map(([r,g,b]) => (r << 16) | (g << 8) | b);

    function spriteTower(x, y, z, w, h, d, kind, warm, id) {
      const low = y + .22, height = h - .22;
      const facade = warm ? [14,15,16,45] : [7,8,9,10];
      const screen = warm ? [16,18,19,20,22] : [31,32,34,35,61];
      const digits = ['07', '13', '04', '31'][id % 4].split('').map(n => AFTERIMAGE_STENCILS[n]);
      const stencil = digits[0].map((row, i) => row + ' ' + digits[1][i]);
      function paintFace(origin, right, width, face) {
        const tw = Math.round(width * 28), th = Math.round(height * 28);
        const columns = Math.max(2, Math.round(width / .49)), floors = Math.max(2, Math.round(height / .71));
        const marksAt = th - 15;
        spriteAtlas.face(origin, right, [0,height,0], tw, th, (i,j) => {
          const section = i / tw * columns, floorLine = j / th * floors;
          const col = Math.floor(section), storey = Math.floor(floorLine);
          const u = section - col, v = floorLine - storey;
          const tone = K.hash(id * 16 + face, col + storey * 11, seed);
          const grime = K.hash(i, (j + face * 23) >> 2, id + 19);
          const seam = i === 0 || i === tw - 1 || v < .07 || u < .075;
          let ink = seam ? facade[0] : facade[tone > .70 ? 2 : 1];
          if (v > .08 && v < .14) ink = facade[3];
          if (grime > .95 && j % 13 < 9) ink = facade[0];
          if (v > .77 && v < .94 && u > .13 && u < .88) {
            const serviceGrille = (id + col * 3 + storey + face) % 5 === 0;
            if (serviceGrille && u < .45) ink = j % 3 === 0 ? facade[3] : facade[0];
            else if (v > .87 && u > .73) ink = (id + col + storey) % 3 === 0 ? facade[3] : facade[2];
          }
          if (kind === 'louver' && v > .73 && (j % 4 === 1)) ink = facade[3];
          if (storey < floors - 1 && u > .15 && u < .86 && v > .24 && v < .71) {
            const frame = u < .22 || u > .79 || v < .30 || v > .65;
            const lit = tone > (kind === 'tier' ? .70 : .78) || (storey + id) % 7 === 1 && tone > .42;
            const divider = Math.abs(u - .56) < .046 || (id % 4 === 2 && v > .46 && v < .52);
            if (frame) ink = v > .64 ? facade[3] : v < .30 && u > .23 && u < .78 ? facade[2] : 0;
            else if (divider) ink = lit ? screen[0] : facade[0];
            else if (lit) {
              const pane = u > .56 ? 1 : 0;
              ink = screen[(j + pane * 2) % 9 === 3 ? 4 : (v < .40 ? 3 : 2 - pane)];
            } else ink = v < .37 && u > .32 ? screen[0] : 0;
            if (v > .70 && u > .21 && u < .79) ink = lit ? screen[0] : facade[2];
          }
          if (j >= marksAt && j < marksAt + 5 && stencil[j - marksAt][i - 5] === '#')
            ink = warm ? 20 : 50;
          if (j > th - 6 && j < th - 3 && i > tw * .66 && i < tw * .90)
            ink = (i + j * 2) % 8 < 3 ? (warm ? 19 : 33) : facade[0];
          return rgbHex[ink];
        });
      }
      paintFace([x-w*.5,low,z+d*.5], [w,0,0], w, 0);
      paintFace([x+w*.5,low,z-d*.5], [-w,0,0], w, 1);
      paintFace([x+w*.5,low,z+d*.5], [0,0,-d], d, 2);
      paintFace([x-w*.5,low,z-d*.5], [0,0,d], d, 3);
      const roofW = Math.ceil(w * 20), roofD = Math.ceil(d * 20);
      spriteAtlas.face([x-w*.5,y+h,z+d*.5], [w,0,0], [0,0,-d], roofW, roofD, (i,j) => {
        const edge = Math.min(i, j, roofW-1-i, roofD-1-j);
        const seams = (i + Math.floor(j / 9) * 5) % 19 === 0 || j % 9 === 0;
        const glint = K.hash(i,j,id) > .983;
        return rgbHex[edge < 2 ? 10 : seams ? 7 : glint ? (warm ? 46 : 51) : (warm ? 43 : 8)];
      });
      spriteAtlas.face([x-w*.5,low,z+d*.5], [w,0,0], [0,0,-d], 1, 1, () => rgbHex[7]);
    }

    function tower(entry, id) {
      const [x, y0, z, w, h, d, kind, warm] = entry;
      const y = Math.max(y0, ridge(x, z) - .08), wall = warm ? bronze : concrete;
      const top = y + h, tint = warm ? ochre : foil;
      block(x, y - .14, z, w + .34, .4, d + .27, concrete, .13);
      if (spriteAtlas) spriteTower(x, y, z, w, h, d, kind, warm, id);
      else block(x, y + .22, z, w, h - .22, d, wall, .151, .075);
      if (kind === 'tier') {
        block(x + .21, top - .06, z - .12, w * .68, .94, d * .65, wall, .121, .082);
        block(x + .34, top + .79, z - .18, w * .42, .72, d * .37, slate, .12);
      } else {
        block(x - .32, top + .04, z + .21, .68, .42, .59, eave, .093);
        block(x + .48, top + .05, z - .32, .48, .31, .67, foil, .094);
        if (kind === 'terrace') block(x - w * .27, top - .59, z + .58, w * .57, .36, d * .67, eave, .113);
      }
      const bands = afterimageTowerBands(kind);
      for (const t of bands) {
        const level = y + h * t;
        block(x, level - .05, z, w + .16, .118, d + .15, eave, .118);
      }
      const rim = kind === 'tier' ? .85 : .19;
      if (h > 3.5) {
        rod([x + .16, top + rim, z - .24], [x + .16, top + rim + 1.01 + id % 3 * .22, z - .24], .043, iron);
        line([x + .16, top + rim + 1.09 + id % 3 * .22, z - .24],
          [x + .16, top + rim + 1.22 + id % 3 * .22, z - .24], .041, warm ? 20 : 35);
      }
      // Retrofit the heavy shells with separate lift banks and exposed condensers.
      if (h > 7.8) {
        const side = id % 2 ? -.42 : .40, zf = z + d * .505, xx = x + w * side;
        block(xx, y + h * .22, zf + .14, .39, h * .81, .36, eave, .113, .066);
        for (const t of [.31, .58, .86]) {
          const yy = y + h * t;
          block(xx, yy, zf + .23, .58, .32, .45, wall, .097);
          line([xx, yy + .198, zf + .46], [xx, yy + .31, zf + .46], .035, warm ? 20 : 34, 2.1);
        }
        const roof = top + (kind === 'tier' ? 1.27 : .33);
        for (const dx of [-.30, .30]) {
          rod([x + dx, roof - .31, z - .30], [x + dx, roof + .92, z - .30], .077, iron);
          line([x + dx, roof + .92, z - .30], [x + dx, roof + 1.04, z - .30], .040, warm ? 41 : 35);
        }
      }
      if (!spriteAtlas) {
        const floors = Math.max(2, Math.floor(h / .70));
        for (const sign of [-1, 1]) {
          for (let row = 1; row < floors; row++) {
            const yy = y + .39 + row * (h - .53) / floors;
            for (const face of [0, 1]) {
              const size = face ? d : w, n = Math.max(2, Math.round(size / .48));
              for (let col = 0; col < n; col++) {
                const u = (col + .5) * size / n - size * .5, r = K.hash(row * 19 + face * 43 + sign * 11, col + id * 22, seed);
                const lit = r > .84 - (row % 3 === 0 && id % 3 === 0 ? .14 : 0);
                const material = lit ? (warm ? amber : jade) : r > .48 ? black : tint;
                if (face === 0) {
                  block(x + u, yy, z + sign * (d / 2 + .002), .235, .25, .063, material, .077);
                  if (lit && row % 2 === id % 2) line([x + u - .075, yy + .21, z + sign * (d / 2 + .047)],
                    [x + u + .075, yy + .21, z + sign * (d / 2 + .047)], .024, warm ? 21 : 35);
                } else block(x + sign * (w / 2 + .005), yy, z + u, .065, .25, .22, material, .077);
              }
            }
          }
        }
        facadePaint(x, y, z, w, h, d, id, warm);
      }
      if (id % 4 === 1 && kind !== 'tier') {
        const deckZ = z + d * .20;
        surfacePaint([x + w * .22, top + .126, deckZ], X, Y, .080,
          AFTERIMAGE_STENCILS.mark, warm ? 19 : 33, id, [0,0,-1]);
        for (let j = 0; j < 8; j++) {
          const x0 = x - w * .40, z0 = z - d * .37 + j * d * .1;
          B.dab(x0, top + .126, z0, Y, X, .027, .044, .01, P[j % 2 ? 10 : 49], 1.6, light);
        }
      }
      if (h > 5 && id % 3 !== 1) {
        const face = z + d * .535, base = y + h * .47;
        const x0 = x + w * .32;
        block(x0, base, face, .47, .96, .18, eave, .097);
        for (let slat = 0; slat < 7; slat++) {
          const yy = base + .152 + slat * .113;
          line([x0 - .18, yy, face + .096], [x0 + .18, yy, face + .096], .016, slat === 5 ? warm ? 19 : 33 : 10, 1.8);
        }
        rod([x0,base,face], [x0,base - .67,face], .057, iron, .078);
        rod([x0,base - .67,face], [x0 - .39,base - .76,face], .055, iron, .078);
      }
      if (id % 2 === 0) {
        rod([x - w * .39, y + .22, z + d * .503], [x - w * .39, top - .03, z + d * .503], .038, tint);
        rod([x - w * .32, y + .21, z + d * .503], [x - w * .32, top - .04, z + d * .503], .032, iron);
      }
    }
    towers.forEach(tower);

    function marketDisplay(x, y, z, serial) {
      const front = z + .595, inside = z + .243, bottom = y + .395;
      const left = x - .448, right = x + .448, top = bottom + .634;
      const frame = { r: [7, 8, 30, 31, 51] };
      const enamel = { r: [14, 15, 16, 17, 18, 19], materialId: 'harbor-market-instrument' };
      const led = (u, v, color) => B.dab(x + u, bottom + v, inside + .075,
        Z, X, .013, .013, .006, P[color], 1.8, light);

      // The return and frame sit in front of the stock. Keep the printed
      // markings on the stock itself so they transmit through the glass.
      for (const side of [left, right]) {
        rod([side,bottom,front], [side,top,front], .021, frame, .036);
        for (const level of [bottom, top]) rod([side,level,inside-.075], [side,level,front], .019, frame, .036);
      }
      for (const level of [bottom, top]) rod([left,level,front], [right,level,front], .024, frame, .036);
      block(x, bottom - .026, z + .38, .87, .047, .44, frame, .081, .012);
      for (const u of [-.29, -.037, .216]) {
        block(x + u, bottom + .04, inside, .219, .266, .122, enamel, .039, .013);
        line([x+u-.08,bottom+.282,inside+.067], [x+u+.08,bottom+.282,inside+.067], .012, 21, 1.46);
        line([x+u-.087,bottom+.11,inside+.071], [x+u+.087,bottom+.11,inside+.071], .009, 15, 1.5);
        led(u-.064,.071,22);
        led(u+.055,.071,35);
      }
      block(x+.09, bottom+.387, inside-.048, .60, .168, .12, frame, .053, .019);
      const digits = serial.split('').map(n => AFTERIMAGE_STENCILS[n]);
      surfacePaint([x-.062,bottom+.468,inside+.026], X, Z, .018,
        digits[0].map((row,i) => row + ' ' + digits[1][i]), 22, 807);
      for (let bar = 0; bar < 6; bar++) {
        const xx = x+.091+bar*.046;
        line([xx,bottom+.431,inside+.027], [xx,bottom+.44+bar*.012,inside+.027], .008,
          bar < 4 ? 34 : 33, 1.78);
      }

      const first = B.count(), pane = { em: true, nd: true };
      function glaze(origin, across, normal, columns) {
        for (let row = 0; row < 10; row++) for (let col = 0; col < columns; col++) {
          const p = V.mad(V.add(origin, [0,(row+.5)*.0634,0]), across, (col+.5)*.064);
          const reflected = col+row*.67;
          const sheen = reflected > columns*.66 && reflected < columns*.66+1.65;
          B.dab(...p, normal, across, .035, .035, .005, P[sheen ? 52 : 9], sheen ? .27 : .10, pane);
        }
      }
      glaze([left,bottom,front], X, Z, 14);
      glaze([left,bottom,front], [0,0,-1], [-1,0,0], 6);
      glaze([right,bottom,front], [0,0,-1], X, 6);
      B.describeSplats(first, B.count(), { material: 'harbor-market-glass' });
      for (const side of [-1, 1]) {
        const xx = x + side * .443;
        line([xx,top,front+.009],[xx-side*.112,top,front+.009],.013,35,1.5);
        line([xx,top,front+.009],[xx,top-.088,front+.009],.013,34,1.54);
        line([xx,bottom,front+.009],[xx-side*.09,bottom,front+.009],.009,33,1.4);
      }
    }

    // A night market fills the quay under the service bridge. The old masonry
    // gives the piping, cables and newer machine housings something to attach to.
    const asphalt = K.pixel.masonry({ r: [7, 8, 9, 43, 44], stone: [18, 12], vary: .45, seed: 400 });
    block(-5.69, .37, 6.43, 3.14, .143, 3.68, asphalt, .122);
    block(4.00, .45, 7.65, 3.82, .165, 2.29, asphalt, .128);
    for (const [x, z, warm, serial] of [
      [-7.52, 5.36, true], [-6.13, 5.11, true, '07'], [-5.04, 5.09, false],
      [4.19, 5.43, false, '13'], [5.93, 7.24, true]
    ]) {
      const y = Math.max(.56, ridge(x, z) + .08), face = z + .54;
      block(x, y, z, 1.04, .34, .85, bronze, .087);
      block(x, y + .34, z - .31, .96, .92, .16, concrete, .092);
      block(x, y + 1.23, z + .11, 1.23, .112, 1.25, warm ? bronze : iron, .084, .062);
      for (const dx of [-.51, .51]) rod([x + dx, y + .05, z + .56], [x + dx, y + 1.27, z + .56], .028, iron, .057);
      line([x - .51, y + 1.22, face + .113], [x + .51, y + 1.22, face + .113], .025, warm ? 20 : 35, 2.9);
      if (serial) marketDisplay(x, y, z, serial);
      for (let k = 0; k < 6; k++) {
        const dx = -.39 + .153 * k;
        if (!serial) {
          const stamp = K.hash(k, Math.round(x * 100), seed);
          block(x + dx, y + .37, z + .21, .113, .065 + .14 * stamp, .12, k < 3 ? foil : ochre, .051, .022);
        }
        if (k % 3 === 0) B.dab(x + dx, y + .011, face + .38, Y, X, .085, .182, .013, P[warm ? 18 : 33], 1.55, dimLight);
      }
      lights.push([x, y + 1.08, face + .12, warm ? 21 : 35]);
    }
    function suspendedWalk(a, b, width) {
      const d = V.sub(b, a), steps = Math.ceil(V.len(d) / .39), ax = B.frame(-Math.atan2(d[2], d[0]), 0, 0);
      const side = V.mul(normal(V.cross(Y, d)), width * .5);
      for (let k = 0; k <= steps; k++) {
        const u = k / steps, p = V.lerp(a, b, u);
        S.box(p, [.236, .12, width * .5], eave, { ax, res: .115, rd: .044 });
        for (const sideSign of [-1, 1]) {
          const q = V.mad(p, side, sideSign);
          rod(q, V.add(q, [0, .71, 0]), .036, iron, .072);
          if (k % 3 === 1) line(V.add(q, [0, .17, 0]), V.add(q, [0, .56, 0]), .017, sideSign > 0 ? 20 : 34, 1.79);
        }
      }
      for (const ss of [-1, 1]) {
        const start = V.mad(V.add(a, [0,.71,0]), side, ss), end = V.mad(V.add(b, [0,.71,0]), side, ss);
        rod(start, end, .036, foil, .073);
      }
    }
    suspendedWalk([-7.67, 4.71, -5.97], [-.98, 4.71, -7.92], 1.08);
    suspendedWalk([4.54, 5.21, -7.91], [8.97, 5.21, -4.94], .92);
    function cable(a, b, sag, wind) {
      const d = V.sub(b, a), n = Math.ceil(V.len(d) / .16);
      for (let k = 0; k <= n; k++) {
        const t = k / n, fall = 4 * t * (1 - t), p = V.lerp(a, b, t);
        const slope = normal([d[0], d[1] - 4 * sag * (1 - 2 * t), d[2] + 4 * wind * (1 - 2 * t)]);
        B.stick(p[0], p[1] - fall * sag, p[2] + fall * wind, slope, .123, .019,
          P[k % 8 === 0 ? 9 : 7], 2.38, { k: 11, ph: t * TAU, sp: 1.1, rg: .018 });
      }
    }
    cable([-8.61, 8.94, -4.74], [-1.47, 9.19, -7.60], .97, .33);
    cable([-7.81, 7.89, -5.29], [-.58, 8.21, -7.34], .85, .28);
    cable([7.91, 7.44, -5.73], [10.52, 6.57, -.94], .85, .51);
    cable([-8.77, 4.43, 5.03], [-5.01, 2.89, 2.62], .49, .21);
    cable([3.11, 2.91, 3.01], [7.39, 3.47, 6.21], .5, -.25);
    // Vent stacks expose what the district does as well as where people live.
    for (const [x, z, y, h, warm] of [[-7.76, -6.34, 9.42, 2.05, true], [8.65, -6.68, 5.44, 1.25, false], [10.42, -.51, 4.35, .84, false]]) {
      rod([x, y, z], [x, y + h, z], .26, bronze, .074);
      for (const t of [.15, .67, .91]) torus(x, y + t * h, z, .256, .036, iron, .066);
      torus(x, y + h, z, .223, .09, eave, .069);
      torus(x, y + h + .028, z, .174, .034, warm ? amber : jade, .059);
    }

    // The elevated service line is a curved, cantilevered ribbon with sparse
    // inset strips, rather than a straight bank of windows.
    const route = i => {
      const t = i / 28, x = -7.70 + 16.8 * t;
      return [x, 2.32 + 1.11 * Math.sin(Math.PI * t), -7.83 + 2.70 * Math.sin(Math.PI * t)];
    };
    for (let i = 0; i < 28; i++) {
      const a = route(i), b = route(i + 1), q = V.lerp(a, b, .5), d = V.sub(b, a);
      S.box(q, [V.len(d) * .52,.051,.33], concrete, { ax: B.frame(-Math.atan2(d[2],d[0]),0,0), res: .093 });
      for (const edge of [-.3,.3]) {
        const aa = V.add(a, [0,.114,edge]), bb = V.add(b, [0,.114,edge]);
        rod(aa, bb, .032, iron, .067);
        if (i % 4 < 2) line(V.add(aa,[0,.036,0]), V.add(bb,[0,.036,0]), .022, edge < 0 ? 34 : 19);
      }
      if (i % 5 === 0) {
        block(q[0], .56, q[2], .19, q[1] - .63, .24, bronze, .102);
        rod([q[0],q[1]-.57,q[2]], [q[0]-.24,q[1]-.051,q[2]+.25], .052, foil);
      }
    }

    // Wayfinding paint is stamped into the quay and transfer decks.
    for (const [x,y,z, ink, turn] of [[-5.56,.525,7.26,18,1],[3.91,.642,7.61,33,-1],[-4.05,.53,4.63,34,-1]]) {
      surfacePaint([x,y,z], [turn,0,0], Y, .128, AFTERIMAGE_STENCILS.arrow, ink, 113 + turn, [0,0,-1]);
      for (let n = 0; n < 4; n++) {
        const step = z + .115 * n + .53;
        line([x-.51,y,step], [x+.51,y,step], .015, n % 2 === 0 ? ink : 9, 1.9);
      }
    }

    // The signal exchange rises in three volumes, with an open cooling gallery.
    const TX = 3.02, TZ = -3.12, FOOT = 5.86;
    function exchangeSkin() {
      const w = 4.03, d = 3.23, y = 3.58, h = 1.09;
      const plaque = AFTERIMAGE_STENCILS['7'].map((row, i) => AFTERIMAGE_STENCILS['0'][i] + ' ' + row);
      function skin(origin, right, width, face) {
        const tw = Math.round(width * 32), th = 35;
        spriteAtlas.face(origin, right, [0,h,0], tw, th, (i,j) => {
          const plate = Math.floor(i / 21), groove = i % 21;
          let ink = [7, 8, 30][Math.floor(K.hash(plate, face, seed) * 3)];
          if (j < 2 || j > th - 3 || groove === 0 || i === tw - 1) ink = 7;
          else if (j === 2 || groove === 1) ink = 10;
          if (j >= 9 && j < 23 && groove >= 4 && groove <= 16 && (plate + face) % 3 !== 1)
            ink = j % 3 === 1 ? (groove > 13 ? 9 : 31) : 0;
          if (j === 5 && (groove === 3 || groove === 18)) ink = 51;
          if (j === 26 && groove >= 5 && groove <= 16) ink = (plate + face) % 3 ? 32 : 21;
          if (j >= 11 && j < 20) {
            const n = Math.floor((i - tw * .52) / 2);
            if (n >= 0 && plaque[Math.floor((j - 11) / 2)]?.[n] === '#') ink = 60;
          }
          if (j > 28 && j < 32 && i > tw - 19 && i < tw - 4) ink = (i + j) % 7 < 3 ? 21 : 16;
          return rgbHex[ink];
        });
      }
      skin([TX-w/2,y,TZ+d/2], [w,0,0], w, 0);
      skin([TX+w/2,y,TZ-d/2], [-w,0,0], w, 1);
      skin([TX+w/2,y,TZ+d/2], [0,0,-d], d, 2);
      skin([TX-w/2,y,TZ-d/2], [0,0,d], d, 3);
      for (const level of [y, y+h])
        spriteAtlas.face([TX-w/2,level,TZ+d/2], [w,0,0], [0,0,-d], 1, 1, () => rgbHex[9]);
    }
    if (spriteAtlas) exchangeSkin();
    for (const [y, w, h, d, m] of [
      [1.08, 5.73, .54, 4.49, bronze], [1.58, 4.91, 1.77, 3.86, concrete],
      [3.37, 5.21, .22, 4.11, eave], [3.58, 4.03, 1.09, 3.23, foil],
      [4.62, 4.66, .14, 3.82, eave], [4.76, 3.51, .53, 2.76, concrete],
      [5.26, 4.07, .21, 3.04, slate]
    ]) if (!spriteAtlas || y !== 3.58) block(TX, y, TZ, w, h, d, m, .134, .065);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      block(TX + sx * 2.31, 1.55, TZ + sz * 1.77, .217, 1.79, .23, bronze, .099);
      rod([TX + sx * 2.15, 3.55, TZ + sz * 1.57], [TX + sx * 1.84, 4.72, TZ + sz * 1.36], .061, amber, .081);
    }
    for (const sign of [-1, 1]) {
      for (let i = 0; i < 9; i++) block(TX - 1.71 + i * .429, 2.21, TZ + sign * 1.96, .287, .64, .062,
        i % 4 === 1 ? amber : black, .071);
      for (const [half, y, z, edge, light] of [[2.5,3.55,2.10,18,21], [2.23,4.75,1.94,33,35]]) {
        if (spriteAtlas) spriteAtlas.face([TX - sign * half,y - .045,TZ + sign * z], [2 * sign * half,0,0], [0,.09,0],
          Math.round(half * 56), 4, (i,j) => rgbHex[i % 17 < 2 ? 7 : j === 1 ? light : edge]);
        else line([TX - half,y,TZ + sign * z], [TX + half,y,TZ + sign * z], .030, light);
      }
    }
    if (!spriteAtlas) for (const side of [-1, 1]) {
      const z = TZ + side * 1.66;
      surfacePaint([TX - .32, 4.23, z], [side,0,0], [0,0,side], .094,
        AFTERIMAGE_STENCILS.mark, 34, 991 + side);
      surfacePaint([TX + .51, 4.24, z], [side,0,0], [0,0,side], .084,
        AFTERIMAGE_STENCILS['7'], 46, 271 + side);
      for (let j = 0; j < 12; j++) {
        const x = TX - 1.42 + .245 * j;
        B.dab(x, 3.89, z, [0,0,side], X, .062, .014, .008, P[j % 4 ? 32 : 20], 1.95, light);
      }
    }
    for (const [radius, y, r, m] of [[1.54, 5.51, .17, iron], [1.24, 5.69, .073, jade],
      [.91, 5.78, .05, foil], [.59, 5.82, .053, jade]]) torus(TX, y, TZ, radius, r, m);
    block(TX, 5.57, TZ, .85, .21, .85, foil, .080);

    // Old trees mark the garden pockets along the quay and on two rooftops.
    const westRoof = Math.max(-.28,ridge(-10.2,-3.08)-.08)+4.04;
    const eastRoof = 4.76;
    const trees = [
      [-9.54,.69,7.06,1.93,.75,'willow',[.43,-.13]],
      [-6.14,.71,7.38,1.61,.60,'flowering',[.22,-.08]],
      [4.19,.75,6.56,1.84,.71,'willow',[-.39,.11]],
      [7.98,.65,5.88,1.51,.56,'street',[-.13,-.07]],
      [11.12,.52,1.26,1.34,.49,'street',[.16,-.08]],
      [-11.37,.42,1.89,1.45,.51,'willow',[.22,.17]],
      [-9.84,westRoof+.12,-3.30,.91,.42,'street',[-.14,.06]],
      [8.56,eastRoof+.12,2.59,1.12,.44,'flowering',[.13,.04]],
      [.25,.67,-6.18,1.69,.60,'street',[.19,.11]]
    ];
    for (const [x,y,z] of [trees[6],trees[7]]) {
      block(x,y-.14,z,.65,.174,.52,bronze,.070,.049);
      block(x,y-.03,z,.55,.055,.43,black,.058);
    }
    for (let k = 0; k < 74; k++) {
      const z = rr(-8.0, 8.9), side = k % 2 ? -1 : 1;
      const edge = 1.33 + .76 * Math.exp(-((z - 2.27) ** 2) / 16.5);
      const x = ford(z) + side * (edge + rr(.02, .27)), y = Math.max(waterY, ridge(x, z));
      if (coast(x, z) > -.55 || (z > 2.21 && z < 3.42)) continue;
      const r = rr(.075, .22), h = rr(.17, .48);
      S.facet({ at: [x, y - .155, z], size: [r, r * .63, r * .82], faces: 6,
        mat: cliff, top: k % 3 === 1 ? leafCold : null, seed: 199 + k, res: .087 });
      if (k % 3 !== 0) S.tube([[x, y, z], [x + .04 * side, y + h * .66, z -.025], [x + .1 * side, y + h, z + .058]],
        .016, .008, { r: [23, 25, 26, 27], fl: { k: 11, ph: k, sp: 2.1, rg: .024 } }, { res: .062 });
      if (k % 4 === 0) B.disc(x - side * .43, waterY + .025, z + .21, Y, rr(.08, .16), .013, P[25], 2.4, { k: 10, sp: .73, rg: .027 });
    }

    // Planting grows in patches on the exposed banks, so the quiet slabs of
    // dark turf read between vertical reeds and the orange seed heads.
    const reed = { r: [23, 24, 25, 26, 27], fl: { k: 11, ph: 1.1, sp: 1.8, rg: .026 } };
    for (const [x, z, width] of [[-5.6, 8.8, .82], [-6.6, 9.14, .40], [-3.88, 7.63, .67],
      [2.49, 8.69, .68], [5.17, 8.75, .70], [6.33, 7.84, .55], [-10.1, 5.82, .54]]) {
      for (let j = 0; j < 24; j++) {
        const a = rr(0, TAU), r = width * Math.sqrt(B.R());
        const u = x + r * Math.cos(a), v = z + r * Math.sin(a) * .78;
        if (land(u, v) > -.045) continue;
        const h = rr(.15, .68), y = ridge(u, v) + .04;
        const top = [u + .31 * h * Math.cos(a), y + h, v + .31 * h * Math.sin(a)];
        S.tube([[u, y, v], [u, y + h * .54, v], top], .019, .009, reed, { res: .047 });
        if (j % 5 === 0) B.stick(...top, Y, .037, .021, P[j % 2 ? 19 : 52], 1.96, { k: 11, ph: a, rg: .027 });
      }
    }

    // A small electric waterbus grounds the scale of the canal. The open aft
    // deck and the lights on both sides survive an orbit below the bridge.
    const boatStart = B.count();
    const boatAt = [ford(6.55) - .27, waterY + .11, 6.55];
    const boatPoint = (x, y, z) => [boatAt[0] + .94 * x + .342 * z,
      boatAt[1] + y, boatAt[2] - .342 * x + .94 * z];
    const boatAxes = B.frame(.35, 0, 0), craft = K.sculpt(makeSculpt(B));
    craft.pixel = true;
    craft.pixelSize(23);
    craft.amb = .32;
    craft.ball(boatAt, [.46, .22, 1.11], { r: [14, 15, 16, 17, 45] }, { ax: boatAxes, res: .061 });
    craft.box(boatPoint(0, .19, -.30), [.37, .061, .64], iron, { ax: boatAxes, res: .062, rd: .083 });
    craft.box(boatPoint(0, .35, .38), [.31, .184, .36], eave, { ax: boatAxes, res: .059, rd: .076 });
    craft.box(boatPoint(0, .55, .36), [.386, .061, .41], bronze, { ax: boatAxes, res: .066, rd: .067 });
    for (const x of [-.315, .315]) {
      for (const z of [.24, .55]) line(boatPoint(x, .43, z - .086), boatPoint(x, .43, z + .086), .059, 34, 2.32);
      line(boatPoint(x, .12, -.77), boatPoint(x, .12, .75), .025, 18, 2.21);
    }
    line(boatPoint(-.105, .29, .90), boatPoint(.105, .29, .90), .042, 22, 2.58);
    craft.bake();
    const boatEnd = B.count();
    for (let j = 0; j < 46; j++) {
      const z = rr(1.03, 1.92), x = rr(-.53, .53);
      B.dab(...boatPoint(x, -.085, z), Y, X, rr(.031, .092), .019, .009, P[j % 3 ? 31 : 18],
        rr(.62, 1.49), { em: true, nd: true, k: 10, ph: z * 2, sp: .73, rg: .029 });
    }

    function lamp(x, y, z, h, warm) {
      rod([x, y, z], [x, y + h, z], .043, iron, .069);
      rod([x, y + h, z], [x + .22, y + h + .1, z], .036, iron);
      block(x + .24, y + h - .051, z, .18, .11, .16, warm ? amber : jade, .052);
      block(x + .24, y + h + .055, z, .23, .058, .20, eave, .064);
      lights.push([x + .24, y + h, z, warm ? 21 : 35]);
    }
    for (const [x, z, base, h, warm] of [
      [-6.03, 4.79, .75, 1.05, true], [-8.4, 3.91, .73, 1.14, true], [-5.54, -1.65, .78, 1.40, true],
      [3.12, 4.18, .63, 1.02, false], [4.44, .91, .59, 1.21, false], [-2.04, -4.33, .75, .98, false],
      [-2.52, 6.03, .43, .86, true], [5.73, -1.16, .67, 1.16, true]
    ]) lamp(x, base, z, h, warm);
    const lanternPaper = 'harbor-lantern-paper', lanterns = [];
    const antiqueBrass = { r: [14,16,45,46,21] };
    function lantern(at, size, variant) {
      const [x, top, z] = at, h = size * 1.52, belly = top - h*.55;
      const radius = t => size*(.53+.42*Math.sin(Math.PI*t));
      // Iron ribs, paper facets, and a hanging knot keep a readable silhouette.
      rod([x,top+.18,z],[x,top,z],.012,antiqueBrass,.032);
      for (const end of [top-h,top]) torus(x,end,z,size*.55,.021,antiqueBrass,.035);
      const start = B.count(), phase = (variant % 3) * .26;
      for (let row = 0; row < 7; row++) {
        const t = (row+.5)/7, y = top-h*t, r = radius(t);
        for (let face = 0; face < 12; face++) {
          const a = face*TAU/12+phase, nx = Math.cos(a), nz = Math.sin(a);
          const pleat = face%3 === 0, rim = row === 0 || row === 6;
          const tone = pleat ? 18 : rim ? 20 : row === 3 || row === 4 ? 22 : 21;
          B.dab(x+r*nx,y,z+r*nz,[nx,0,nz],[-nz,0,nx],r*.28,h*.087,.007,P[tone],
            pleat ? 1.52 : 2.02,{ em: true });
        }
      }
      B.describeSplats(start,B.count(),{ material: lanternPaper });
      for (let rib = 0; rib < 4; rib++) {
        const a = rib*TAU/4+phase, nx = Math.cos(a), nz = Math.sin(a);
        const points = Array.from({ length: 5 },(_,j) => {
          const t = j/4, r = radius(t)+.012;
          return [x+r*nx,top-h*t,z+r*nz];
        });
        S.tube(points,.010,.010,antiqueBrass,{ res: .034 });
      }
      const base = top-h-.028;
      rod([x,base,z],[x,base-.095,z],.011,antiqueBrass,.037);
      line([x,base-.04,z],[x+.033,base-.133,z+.015],.014,39,1.51,{});
      const halo = B.count();
      B.dab(x,belly,z,Z,Y,h*.63,size*.86,.025,P[20],.16,dimLight);
      B.dab(x,belly,z,X,Y,h*.61,size*.84,.025,P[21],.14,dimLight);
      B.describeSplats(halo,B.count(),{ material: lanternPaper });
      S.lights.push({ p: [x,belly-.08,z], r: 1.14+size, s: .47, c: [18,21,22] });
      lanterns.push([x,belly,z]);
    }
    function festoon(a, b, baseA, baseB, count, sag, lanternSize) {
      for (const [p,y] of [[a,baseA],[b,baseB]]) {
        const [x,top,z] = p;
        block(x,y,z,.19,.12,.17,bronze,.065);
        rod([x,y+.02,z],[x,top+.05,z],.037,iron,.066);
        torus(x,top+.004,z,.047,.019,antiqueBrass,.046);
      }
      const at = t => V.add(V.lerp(a,b,t),[0,-4*t*(1-t)*sag,0]);
      const spans = Math.ceil(V.dist(a,b)/.20);
      for (let i = 0; i < spans; i++) {
        const a = at(i/spans), b = at((i+1)/spans), dir = normal(V.sub(b,a));
        B.stick(...V.lerp(a,b,.5),dir,V.dist(a,b)*.68,.014,P[9],1.9);
      }
      for (let j = 1; j <= count; j++) {
        const p = at(j/(count+1));
        lantern(V.add(p,[0,-.17-.028*(j%2),0]),lanternSize*(j%3 === 0 ? .82 : 1),j);
      }
    }
    festoon([-8.52,2.96,6.59],[-4.63,2.81,6.32],.69,.63,5,.29,.191);
    festoon([3.55,2.93,4.37],[7.23,3.34,4.10],.63,.66,4,.21,.171);
    const crossing = ford(2.65);
    festoon([crossing-2.87,2.92,3.27],[crossing+3.39,2.89,3.27],1.42,1.42,6,.41,.172);
    for (const [x, y, z, c] of lights) S.lights.push({ p: [x, y + .04, z], r: 2.78, s: .58, c: c === 21 ? [18, 20, 21] : [32, 34, 35] });
    S.lights.push({ p: [TX + .42, 6.94, TZ + .22], r: 5.0, s: .64, c: [31, 34, 35] });
    S.bake();
    growAfterimageHarbor(B, S, { seed, planters, ridge, land, ford, towers, trees, trunk });
    S.bake();
    const townEnd = B.count();

    // The courier is a solid relief on all sides, with a cheek plane, bobbed
    // hair, a folded collar and a split coat. Body joints retain their own IDs.
    const parts = {};
    const record = (name, pivot, parent) => {
      parts[name] = { ids: [], pivot, parent };
      return { tag: name };
    };
    const heading = .26, c = Math.cos(heading), s = Math.sin(heading);
    const f = (x, y, z) => [TX + x * c + z * s, FOOT + y, TZ - x * s + z * c];
    const axes = B.frame(heading, 0, 0);
    const projectionMaterial = 'harbor-projector-coat';
    const attire = { r: [7, 30, 31, 32, 33, 34], a: 2.15, fine: false, materialId: projectionMaterial };
    const lining = { r: [15, 31, 32, 33, 34, 59], a: 2.05, materialId: projectionMaterial };
    const porcelain = { r: [31, 32, 33, 34, 60, 36, 61], a: 2.28 };
    const hair = { r: [7, 14, 24, 30, 31, 33], a: 2.52 };
    const hairEdge = { r: [24, 30, 31, 32, 33], a: 2.45 };
    const trim = { r: [32, 33, 34, 35, 60], a: 2.45 };
    const foilDark = { r: [1, 7, 23, 30, 31], a: 2.62 };
    const eyeBlack = { r: [1, 7, 30], em: true };
    const eyeLamp = { r: [35, 60, 61], em: true };
    S.amb = .28; S.sky = .28; S.sunK = .51; S.sun = normal([-.77, .70, 1]);
    S.shLen = 2.7; S.aoK = .49;
    S.lights.length = 0;
    S.lights.push({ p: f(-1.4, 6.35, 2.1), r: 4.9, s: .72, c: [32, 34, 35] });
    S.lights.push({ p: f(1.4, 4.97, -1.65), r: 4.65, s: .34, c: [31, 34, 35] });
    const oldEmit = S.emit;
    S.emit = (shape, start, end) => {
      if (oldEmit) oldEmit(shape, start, end);
      if (parts[shape?.tag]) for (let i = start; i < end; i++) parts[shape.tag].ids.push(i);
    };
    const spec = (tag, res) => ({ tag, res, ax: axes });
    const ball = (name, at, radius, mat, res = .067) => S.ball(f(...at), radius, mat, spec(name, res));
    const tube = (name, points, r0, r1, mat, res = .060) => S.tube(points.map(p => f(...p)), r0, r1, mat, { tag: name, res });
    const trimRun = (name, points, width) => tube(name, points, width, width * .81, trim, .052);
    const bodyStart = B.count();
    record('hips', f(0, 2.9, 0));
    record('chest', f(.02, 3.49, 0), 'hips');
    record('head', f(-.08, 5.03, .04), 'chest');
    record('fringe', f(.06, 5.53, -.17), 'head');
    record('coatLeft', f(-.35, 3.16, .10), 'hips');
    record('coatRight', f(.38, 3.24, -.14), 'hips');
    ball('hips', [.02, 2.98, -.03], [.57, .51, .34], attire);
    ball('chest', [.04, 4.03, -.04], [.63, 1.04, .35], attire);
    ball('chest', [-.02, 4.37, .03], [.67, .55, .39], attire);
    tube('chest', [[-.03, 4.72, .01], [-.08, 5.19, .07]], .29, .23, porcelain);
    S.lathe(f(-.045, 4.64, .034), .54, [0.40, .32, .33], lining, spec('chest', .061));
    trimRun('chest', [[-.39, 4.93, .23], [-.16, 5.03, .382], [.15, 4.97, .375], [.30, 4.78, .22]], .037);
    trimRun('chest', [[-.17, 4.91, .31], [-.19, 4.45, .389], [-.044, 4.13, .375], [.066, 3.66, .353], [.019, 3.28, .32]], .033);
    trimRun('hips', [[-.47, 3.20, .14], [-.28, 3.18, .304], [.14, 3.17, .355], [.46, 3.31, .12]], .055);
    S.box(f(.13, 3.19, .37), [.094, .067, .032], foil, { ...spec('hips', .046), rd: .021 });
    ball('head', [-.085, 5.56, .065], [.539, .631, .48], porcelain, .048);
    ball('head', [-.055, 5.31, .183], [.414, .399, .369], porcelain, .044);
    ball('head', [-.11, 5.46, .531], [.084, .115, .082], porcelain, .035);
    ball('head', [-.095, 5.27, .498], [.154, .035, .032], foilDark, .026);
    ball('head', [-.112, 5.25, .513], [.106, .017, .021], porcelain, .027);
    ball('head', [-.104, 5.555, -.103], [.588, .659, .487], hair, .064);
    ball('head', [.023, 5.997, .045], [.486, .254, .471], hair, .054);
    ball('head', [-.334, 5.811, .281], [.273, .226, .274], hair, .060);
    tube('head', [[-.24, 6.033, .315], [-.441, 5.824, .367], [-.505, 5.57, .29], [-.461, 5.30, .219]], .128, .06, hair, .052);
    tube('fringe', [[.137, 5.964, .294], [.393, 5.812, .33], [.41, 5.565, .204], [.514, 5.273, .121]], .142, .079, hair);
    tube('fringe', [[.285, 5.816, -.13], [.489, 5.533, -.374], [.523, 5.17, -.29], [.645, 5.07, -.06]], .235, .112, hairEdge, .057);
    trimRun('fringe', [[.272, 5.971, .219], [.444, 5.761, .255], [.498, 5.49, .118]], .029);
    for (const sign of [-1, 1]) {
      const x = -.093 + sign * .208, eyeY = sign === 1 ? 5.624 : 5.590;
      ball('head', [x, eyeY, .493], [.109, .039, .037], eyeBlack, .027);
      ball('head', [x + .022, eyeY - .006, .52], [.031, .029, .016], eyeLamp, .023);
      tube('head', [[x - .092, eyeY + .086, .478], [x + .071, eyeY + .084 + .022 * sign, .49]], .016, .016, hair, .032);
      ball('head', [x + sign * .257, 5.49, .038], [.112, .155, .086], porcelain, .059);
    }
    ball('head', [.445, 5.331, .185], [.064, .065, .052], eyeLamp, .037);

    // An asymmetrical wet-work respirator, side receiver and locked torso rig.
    const ceramic = { r: [7, 8, 30, 31, 32], a: 2.37 };
    const lensGlow = { r: [39, 40, 20, 22], a: 2.49, em: true };
    S.box(f(.215, 5.604, .503), [.185, .098, .047], ceramic, { ...spec('head', .036), rd: .046 });
    tube('head', [[.051, 5.622, .555], [.224, 5.616, .562], [.367, 5.679, .508]], .027, .021, lensGlow, .028);
    tube('head', [[.37, 5.684, .501], [.514, 5.599, .34], [.528, 5.42, .105]], .038, .034, trim, .036);
    ball('head', [.505, 5.45, .081], [.119, .219, .150], ceramic, .052);
    tube('head', [[.52, 5.456, .19], [.521, 5.34, .18]], .035, .029, lensGlow, .031);
    tube('head', [[.47, 5.31, .06], [.313, 5.15, .221], [.102, 5.16, .374]], .039, .028, foilDark, .043);
    for (const sign of [-1, 1]) {
      S.box(f(sign * .578, 4.46, -.089), [.213,.144,.233], ceramic, { ...spec('chest', .051), rd: .094 });
      trimRun('chest', [[sign * .67, 4.57, .103], [sign * .54, 4.61, .213], [sign * .33, 4.45, .373]], .039);
      tube('chest', [[sign * .296, 4.52, -.304], [sign *.22, 4.05, -.429], [sign * .16, 3.61, -.312]], .045, .034, foilDark, .043);
    }
    ball('chest', [0, 3.91, -.385], [.27,.485,.152], ceramic, .063);
    for (let j = 0; j < 5; j++) {
      const y = 3.61 + j * .126;
      trimRun('chest', [[-.12,y,-.512],[.12,y,-.512]], .022);
    }

    // The sleeves and hands are individual articulated pieces. The flare of the
    // coat carries a second trailing joint so it opens with the reaching pose.
    for (const side of [-1, 1]) {
      const active = side < 0;
      const shoulder = [side * .57, 4.51, .006], elbow = [side * (active ? .98 : .88), active ? 3.85 : 3.89, .035];
      const wrist = [side * (active ? 1.34 : 1.02), active ? 3.44 : 3.22, active ? .40 : .12];
      const hand = [side * (active ? 1.47 : 1.047), active ? 3.31 : 3.05, active ? .51 : .15];
      const upper = active ? 'reachArm' : 'otherArm', lower = active ? 'reachForearm' : 'otherForearm';
      const palm = active ? 'reachHand' : 'otherHand';
      record(upper, f(...shoulder), 'chest'); record(lower, f(...elbow), upper); record(palm, f(...wrist), lower);
      tube(upper, [shoulder, [side * .73, 4.30, -.018], elbow], .214, .143, attire);
      tube(lower, [elbow, [side * (active ? 1.18 : .95), 3.61, .18], wrist], .147, .10, lining);
      trimRun(lower, [[wrist[0] - .077, wrist[1] + .035, wrist[2] + .047], [wrist[0] + .079, wrist[1] + .042, wrist[2] + .035]], .032);
      ball(palm, hand, [.101, .166, .076], porcelain, .044);
      for (let k = 0; k < (active ? 4 : 2); k++) {
        const p = [hand[0] + (k - 1.5) * .050, hand[1] - .084, hand[2] + .021];
        tube(palm, [p, [p[0] + side * .04, p[1] - (.077 + .017 * (k % 3)), p[2] + .066]], .027, .018, porcelain, .035);
      }
      const hip = [side * .277, 2.83, -.005], knee = [side * .407, 1.64, side * .105];
      const ankle = [side * .52, .60 + (active ? .07 : 0), side * .105];
      const leg = active ? 'leftLeg' : 'rightLeg', shin = active ? 'leftShin' : 'rightShin';
      record(leg, f(...hip), 'hips'); record(shin, f(...knee), leg);
      tube(leg, [hip, [side * .34, 2.23, .06], knee], .229, .149, foilDark);
      tube(shin, [knee, [side * .46, 1.07, side * .109], ankle], .162, .112, attire);
      ball(shin, [ankle[0], ankle[1] - .045, ankle[2] + .124], [.159, .13, .28], foilDark, .049);
      trimRun(shin, [[ankle[0] - .088, ankle[1] + .23, ankle[2] + .078], [ankle[0] + .113, ankle[1] + .204, ankle[2] + .071]], .035);
    }
    // A fabric lattice has smooth curvature across the coat and clean hems.
    for (const [name, side, spread] of [['coatLeft', -1, .86], ['coatRight', 1, 1.47]]) {
      const count = 8;
      for (let panel = 0; panel < count; panel++) {
        const u = panel / (count - 1), theta = side * (.28 + u * 1.94);
        const a = [Math.sin(theta) * .47, 3.34, -.14 + Math.cos(theta) * .32];
        const b = [Math.sin(theta) * (.69 + spread * .26), 2.56, Math.cos(theta) * .55 - .31];
        const end = [Math.sin(theta) * (.85 + spread * .37) + .40 * side, .92 + .82 * u * u,
          -.48 + Math.cos(theta) * (.61 + spread * .18) - spread * .29 * u];
        tube(name, [a, b, end], .144, .154, panel % 3 ? attire : lining, .063);
        if (panel === 0 || panel === count - 1) trimRun(name,
          [[a[0], a[1], a[2] + .11], [b[0], b[1], b[2] + .11], [end[0], end[1], end[2] + .105]], .039);
      }
    }
    S.bake();
    S.emit = oldEmit;
    const bodyEnd = B.count();

    // Copper signs are physical screens. Their image is made of thin lit dabs
    // so the lettering, thickness, and bracket remain in the world as it turns.
    const koiPixels = Uint8Array.from(atob(AFTERIMAGE_KOI.data), value => value.charCodeAt(0));
    const ad = [];
    function screen(name, at, w, h, yaw, warm, paint, brace = true) {
      const first = ad.length, nx = Math.sin(yaw), nz = Math.cos(yaw);
      const right = [nz, 0, -nx], n = [nx, 0, nz];
      const point = (side, x, y, depth) => [
        at[0] + x * right[0] * side + nx * depth * side, at[1] + y,
        at[2] + x * right[2] * side + nz * depth * side
      ];
      const ink = warm ? 20 : 35, shade = warm ? 14 : 23;
      for (const side of [-1, 1]) {
        for (const u of [-.50, .50]) {
          line(point(side, u * w, -.42 * h, .12), point(side, u * w, .42 * h, .12), .049, warm ? 17 : 32, 2.5);
          for (const v of [-1, 1]) line(point(side, u * w, v * h * .43, .15), point(side, u * w * .86, v * h * .50, .15), .028, ink);
        }
        for (const v of [-.50, .50]) line(point(side, -.43 * w, v * h, .15), point(side, .43 * w, v * h, .15), .034, ink);
        if (brace) for (const x of [-.36, .36]) line(point(side, x * w, -.51 * h, 0),
          point(side, x * w - .17, -.51 * h - .65, -.17), .077, warm ? 17 : 9);
        const gridW = Math.max(32, Math.ceil(w * 24)), gridH = Math.max(18, Math.ceil(h * 25));
        const du = w / gridW, dv = h / gridH, no = V.mul(n, side), across = V.mul(right, side);
        const cols = Math.ceil(w / .145), rows = Math.ceil(h / .145), dx = w / cols, dy = h / rows;
        for (let j = 0; j < rows; j++) for (let k = 0; k < cols; k++) {
          const u = (k + .5) / cols, v = (j + .5) / rows;
          B.dab(...point(side, (u - .5) * w, (.5 - v) * h, .074), no, across, dx * .69, dy * .65, .019,
            P[K.hash(k, j, seed) > .96 ? shade + 1 : shade], 2.78, light);
        }
        for (let y = 0; y < gridH; y++) for (let x = 0; x < gridW; x++) {
          const u = (x + .5) / gridW, v = (y + .5) / gridH;
          if (Math.min(u, 1 - u, v, 1 - v) < .029 && Math.min(u, 1 - u) < .073 && Math.min(v, 1 - v) < .091) continue;
          const code = paint(u, v);
          if (code !== undefined) ad.push({ u, v, kind: name, across, no,
            q: point(side, (u - .5) * w, (.5 - v) * h, .171), du, dv, w, h, code });
        }
      }
      return [first, ad.length];
    }
    function kana(word, u, v, h) {
      if (u < 0 || v < 0 || v >= h) return false;
      const x = Math.floor(u * 16 / h), y = Math.floor(v * 16 / h);
      const name = word[Math.floor(x / 18)];
      return name && x % 18 < 16 && ((AFTERIMAGE_BRUSHES[name][y] >> (x % 18)) & 1);
    }
    const westScreen = screen('koi', [-7.02, 3.65, -.90], 3.78, 1.74, .26, true, (u, v) => {
      if (kana('ミナト', u - .062, v - .073, .14)) return 22;
      if (v < .21 || v > .86 || u < .065 || u > .944) return;
      const x = Math.floor((u - .065) / .879 * AFTERIMAGE_KOI.width);
      const y = Math.floor((v - .21) / .65 * AFTERIMAGE_KOI.height);
      return koiPixels[y * AFTERIMAGE_KOI.width + x] || undefined;
    });
    const eastScreen = screen('spectrum', [8.42, 5.21, 3.68], 2.74, 2.16, .40, false, (u, v) => {
      if (kana('キオク', u - .094, v - .067, .138)) return 35;
      const x = (u - .50) * 1.15, y = v - .562, r = Math.hypot(x, y);
      if (Math.abs(r - .31) < .014 || Math.abs(r - .24) < .012 || Math.abs(r - .135) < .011) return 32;
      if (r < .319 && (Math.abs(x) < .014 || Math.abs(y) < .012)) return 31;
      if (r <= .35 && r > .32 && Math.cos(Math.atan2(y, x) * 44) > .62) return 33;
      if (r < .29 && Math.floor(u * 56) % 3 === 0 && Math.floor(v * 51) % 3 === 0) return 32;
      return undefined;
    });
    function verticalWord(word, u, v) {
      const row = Math.floor((v - .075) / .245);
      return row >= 0 && row < word.length && kana(word[row], (u - .17) * .39, v - .075 - row * .245, .205);
    }
    const redPylon = screen('port-tower', [-9.46, 6.94, -4.47], 1.53, 4.45, .24, true, (u, v) => {
      if (verticalWord('ミナト', u, v)) return 22;
      if (u < .12 || u > .89) return v > .12 && v < .84 ? 39 : undefined;
      if (v > .84 && v < .91 && Math.floor(u * 27 + v * 13) % 7 < 4) return 20;
      if (v > .22 && v < .76 && Math.floor(v * 57) % 7 === 0) return 17;
      return undefined;
    });
    const bluePylon = screen('archive-tower', [9.48, 7.39, -2.78], 1.47, 4.55, .36, false, (u, v) => {
      if (verticalWord('キオク', u, v)) return 61;
      if (u < .10 && v < .84 && Math.floor(v * 45) % 4 < 3) return 34;
      if (v > .83 && v < .91 && u > .13 && u < .87 && Math.floor(u * 58) % 4 < 2) return 35;
      return undefined;
    });
    const marketSign = screen('night-market', [-6.63, 2.43, 5.94], 2.44, .63, .22, true, (u, v) => {
      if (kana('ミナト', (u - .09) * .43, v - .11, .28)) return 22;
      if (u > .64 && v > .23 && v < .62 && Math.abs(u - .87 + Math.abs(v - .43) * .36) < .017) return 40;
      if (v > .65 && v < .74 && u > .11 && u < .81 && Math.floor(u * 31) % 4 !== 1) return 19;
      return undefined;
    });
    const label = screen('label', [TX + .31, 2.72, TZ + 2.26], 1.27, .45, 0, false,
      (u, v) => kana('残像', u - .18, v - .15, .31) ? 35 : undefined);

    // Low wayfinding signs sit close enough to the water to read in its mirror.
    function quaySign(z, side, number) {
      const warm = side < 0, x = ford(z) + side*2.02;
      const digits = number.split('').map(n => AFTERIMAGE_STENCILS[n]);
      const face = digits[0].map((row,i) => row+' '+digits[1][i]);
      const label = (u,v) => face[Math.floor((v-.23)*10)]?.[Math.floor((u-.11)*17)] === '#';
      rod([x-.44,.48,z],[x-.44,1.02,z],.037,iron,.060);
      rod([x+.44,.48,z],[x+.44,1.02,z],.037,iron,.060);
      return screen(warm ? 'quay-red' : 'quay-blue', [x,.98,z], 1.23,.48,side*-.19,warm,(u,v) => {
        if (v > .76 && u > .09 && u < .89) return warm ? 20 : 34;
        if (label(u,v)) return warm ? 22 : 60;
        if (u > .66 && u < .89 && Math.abs((v-.47)-side*(u-.76)*1.7) < .055) return warm ? 20 : 35;
      }, false);
    }
    const westQuay = quaySign(3.84,-1,'07'), eastQuay = quaySign(4.95,1,'13');
    S.bake();

    // Only the artwork pixels enter the animation stream. The backing, frame
    // and fittings above are static and never dirtied by a billboard scan.
    const adStart = B.count();
    for (const pixel of ad) {
      const { q, across, no, du, dv, code } = pixel;
      pixel.i = B.count() * 16;
      B.dab(...q, no, across, du * .53, dv * .48, .015, P[code], 1.94, light);
    }
    for (const [ranges, material] of [
      [[westScreen,redPylon,marketSign,westQuay], 'harbor-vermilion-phosphor'],
      [[eastScreen,bluePylon,label,eastQuay], 'harbor-cyan-phosphor']
    ]) {
      for (const [first,end] of ranges) B.describeSplats(adStart+first,adStart+end,{ material });
    }
    // Narrow horizontal water marks sit below the visible sources. Broken
    // clusters stretch the light into the basin and fold when it rains.
    for (const [x0, y0, z0, col] of lights.concat([[-5.22, 3.5, -.02, 21], [2.30, 2.4, -.73, 35]])) {
      for (let k = 0; k < 59; k++) {
        const x = x0 + rr(-.89, .89), z = z0 + rr(-2.1, 2.1), rank = n3(x * 2.7, z * 2.0, 12);
        if (channel(x, z) > -.065 || coast(x, z) > .26 || rank < .35) continue;
        const p = .17 + Math.abs(z - z0) * .27, w = rr(.026, .15) * p;
        B.dab(x, waterY + .019, z, Y, X, w, rr(.012, .027), .009, P[col === 21 ? rank > .60 ? 19 : 17 : rank > .64 ? 34 : 31],
          1.44, { em: true, nd: true, k: 10, ph: x * 2, sp: .95, rg: .041, ex: .4 });
      }
    }
    for (let k = 0; k < 635; k++) {
      const z = rr(-10.3, 12.2), x = rr(-14.7, 15.1), h = n3(x * .76, z * .68, 7);
      if (coast(x * .88, z * .88) > -.16 || land(x, z) < .06 || h < .47) continue;
      B.dab(x, waterY + .023, z, Y, X, rr(.037, .16), rr(.010, .031), .013, P[h > .70 ? 50 : 3], rr(.8, 1.88),
        { k: 10, ph: z + x * .3, sp: .76, rg: .035, em: true });
    }
    for (const [x, , z] of lanterns) {
      if (channel(x,z) > -.28) continue;
      for (let i = 0; i < 14; i++) {
        const t = i/14, shift = Math.sin(i*3.7+x)*(.043+t*.14);
        const at = [x+shift,waterY+.021,z+.047+i*.103];
        if (channel(at[0],at[2]) > -.07) continue;
        B.dab(...at,Y,X,.039+t*.066,.014,.007,P[i%3 ? 21 : 22],1.51-t*.78,
          { em: true, nd: true, k: 10, ph: x, sp: .86, rg: .032, ex: .4 });
      }
    }
    // Reflected silhouettes use the native pool clipping and ripple pass. Only
    // river-facing silhouettes and selected enameled lights enter the proxy.
    for (const [z0, side, ink] of [[-2.56,-1,20], [-.61,1,34], [2.29,-1,40], [5.47,1,34], [7.22,-1,18]]) {
      for (let k = 0; k < 156; k++) {
        const z = z0 + rr(-1.57, 1.57), u = rr(-.87, .87), t = Math.abs(z-z0) / 1.57;
        const x = ford(z) + side * (.76 + .47 * t) + u * (.28 + .57 * t);
        if (channel(x,z) > -.012 || n3(x * 3, z * 1.9, 27) + .17 * B.R() < .42 + .19 * t) continue;
        B.dab(x, waterY + .011, z, Y, X, rr(.045, .167), rr(.014, .029), .01,
          P[k % 7 === 0 ? ink : ink === 40 ? 38 : ink - 1], .63 + .93 * (1 - t),
          { em: true, nd: true, k: 10, ph: x * 3.3, sp: 1.17, rg: .053, ex: .4 });
      }
    }
    const reflectionStart = B.count(), sample = new Array(10);
    const litWater = new Set([15,16,17,18,19,20,21,23,24,25,26,31,32,33,34,35,59,60]);
    for (let i = waterEnd; i < townEnd; i += 4) {
      if (!B.dabAt(i, sample)) continue;
      const [x, y, z, nx, ny, nz, , , , ink] = sample;
      if (y < .21 || y > 6.55 || Math.abs(x - ford(z)) > 4.02 || !litWater.has(ink) || ny > .77) continue;
      const n = V.norm([nx,-ny,nz]), turn = V.norm(V.cross(Y,n), X);
      B.dab(x, 2 * waterY - y, z, n, turn, .121, .076, .021, P[ink], 1.29, { nd: true, ex: i+1 });
    }
    for (const [first,end] of [westQuay,eastQuay]) {
      for (let i = first; i < end; i++) {
        const { q:[x,y,z], no:[nx,ny,nz], across, du, dv, code } = ad[i];
        if (nz < 0) continue;
        B.dab(x,2*waterY-y,z,[nx,-ny,nz],across,du*.85,dv*.61,.012,P[code],1.88,
          { nd:true, ex:adStart+i+1, ph:1 });
      }
    }
    const reflectionEnd = B.count();
    const signalStart = B.count();
    const iris = [], centre = f(0, 3.76, .35), front = [s, 0, c];
    for (let row = -28; row <= 28; row++) for (let col = -55; col <= 55; col++) {
      const x = col * .049, y = row * .049, angle = Math.atan2(y, x), r = Math.hypot(x, y), ir = 1.10;
      const lid = 1.27 * (1 - Math.abs(x / 2.67) ** 1.65);
      const ink = Math.abs(Math.abs(y) - lid) < .046 ? 21 :
        Math.abs(ir - r) < .039 || Math.abs(.31 - r) < .042 ? 22 :
        r > .32 && r < ir && Math.sin(angle * 34 + 11.0 * r) > -.23 && Math.abs(y) < lid ? (row % 5 < 2 ? 18 : 20) : 0;
      if (!ink) continue;
      const i = B.count() * 16;
      B.dab(...f(x, 3.76 + y, .33 + .085 * Math.cos(r * 2.3)), front, [c,0,-s],
        .035, .032, .013, P[ink], 0, light);
      iris.push({ i, x, y, r, row, col, ink });
    }
    const irisRange = [signalStart, B.count()];
    for (let i = 0; i < 408; i++) {
      const start = B.count() * 16, a = B.R(), b = B.R(), c0 = B.R();
      B.dab(...centre, front, [c,0,-s], .026 + .072 * c0, .013 + .019 * b, .008,
        P[i % 7 ? 35 : 22], 0, { em: true, nd: true });
      sails.push({ i: start, a, b, c: c0 });
    }
    const receiverGuides = [];
    for (let j = 0; j < 187; j++) {
      const angle = TAU * j / 187;
      if (j % 29 > 20 || Math.abs(Math.sin(angle)) > .89 && j % 5 !== 0) continue;
      const major = j % 6 === 0, radius = major ? 2.84 : 2.72;
      const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
      const i = B.count() * 16;
      B.dab(...f(x, 3.37 + y, -.25), front, [c,0,-s], .027, major ? .065 : .023, .009, P[major ? 35 : 32], 0, dimLight);
      receiverGuides.push({ i, angle, radius, major });
    }
    // Two courier craft cross in opposite lanes. Each cabin, running light
    // and exhaust dash moves as part of its own world-space model.
    const traffic = [];
    for (const [lane, z, y, sign, ink, offset] of [[0, 7.94, 4.51, 1, 34, .06], [1, -.13, 10.26, -1, 20, .51]]) {
      const first = B.count(), model = K.sculpt(makeSculpt(B));
      const anchor = [-sign * 12.4, y, z];
      const go = (u, v, w) => V.add(anchor, [u * sign,v,w * sign]);
      model.amb = .28;
      model.pixel = true;
      model.pixelSize(24);
      model.ball(anchor, [.72,.15,.27], { r: [7,8,9,10,46] }, { res: .066 });
      model.box(go(.19,.145,0), [.26,.14,.178], { r: [7,31,32,33] }, { rd: .064, res: .056 });
      for (const side of [-1, 1]) {
        model.ball(go(-.13,-.025,side * .248), [.43,.085,.098], eave, { res: .059 });
        line(go(.33,.012,side * .258), go(.59,.012,side * .215), .031, ink, 2.66);
        line(go(-.535,.012,side * .265), go(-.71,.007,side * .265), .042, ink === 20 ? 40 : 35, 2.42);
        B.stick(...go(-.97,-.01,side * .22), X, .205, .038, P[ink], .46, dimLight);
      }
      line(go(.63,.008,-.107), go(.63,.008,.107), .024, lane ? 22 : 61, 2.66);
      model.bake();
      traffic.push({ first, end: B.count(), sign, offset });
    }
    K.shafts(B, { from: [TX, FOOT + .09, TZ], dir: [.025, .99, .044], len: 4.1, r: .41, n: 27, col: 34, a: .17 });
    K.shafts(B, { from: [-7.85, 3.75, -.33], dir: [.23,-.92,.35], len: 3.4, r: .28, n: 21, col: 19, a: .12 });
    K.mist(B, { at: [-1,0,0], y: -.10, depth: .46, rad: 13.6, zs: .75,
      cols: [3,4,31,32], n: 235, size: [.81,1.59], a: .103, drift: .39,
      where: (x, z) => channel(x,z) < -.3 && coast(x,z) < .8 });
    K.mist(B, { at: [-1,0,0], y: .41, depth: .67, rad: 12.1, zs: .76,
      cols: [8,9,31], n: 113, size: [1.08,2.02], a: .051, drift: .47,
      where: (x,z) => z < -2 && coast(x,z) < -.2 });
    // Wet streets are lit in layers, with deeper parcels of drifting exhaust.
    for (const [x, y, z, ink, tilt] of [[-8.2, 4.06, .1, 19, .68], [7.45, 4.93, 3.24, 33, -.48],
      [-5.7, 2.47, 5.85, 39, .45], [9.37, 8.04, -2.66, 33, -.42]]) {
      K.shafts(B, { from: [x, y, z], dir: [tilt,-.96,.45], len: y * .93, r: .42, n: 25, col: ink, a: .14 });
      K.mist(B, { at: [x,0,z], y: Math.max(-.08, y * .26 - .61), depth: .76, rad: 2.53, zs: .57,
        cols: [ink - 1, ink, 8], n: 23, size: [.65,1.93], a: .078, drift: .61 });
    }
    for (const [x,y,z] of [[-7.76,11.49,-6.34],[8.65,6.72,-6.68],[10.42,5.2,-.51]]) {
      for (let j = 1; j <= 20; j++) {
        const u = j / 20, px = x + 2.62 * u * u + rr(-.22,.22);
        B.axial(px, y + 1.63 * u, z + .73 * u + rr(-.16,.16), [1,.33,.14],
          .31 + .50 * u, .08 + .21 * u, P[j % 3 ? 31 : 37], .16 * (1 - u * .72),
          { k: 11, ph: u * TAU, sp: .47, rg: .24, nd: true });
      }
    }
    const rainDirection = normal([.31,-1,-.17]);
    for (let k = 0; k < 2420; k++) {
      const x = rr(-15.4, 15.5), z = rr(-11.8, 12.5), y = rr(0, 16.6);
      const shadowed = n3(x * .29, z * .314, 3) < .44;
      const colored = x < -3.3 && shadowed ? 38 : shadowed ? 33 : 5;
      B.stick(x,y,z,rainDirection,rr(.09,.27),rr(.008,.017),P[colored],rr(.16,.59),
        { k: 2, ph: B.R(), sp: rr(11.2,18.0), rg: 16.6, nd: true, em: true });
    }
    for (let i = 0; i < 127; i++) {
      const x = rr(-11.1, 11.3), z = rr(-8.9, 10.2);
      if (coast(x,z) > -.2 || land(x,z) > .3 && i % 3) continue;
      const warm = x < ford(z);
      B.iso(x, rr(.45,2.61), z, rr(.018,.048), P[warm ? i % 3 ? 20 : 40 : i % 3 ? 34 : 29], rr(.44,1.03),
        { k: 3, ph: B.R(), sp: rr(.16,.29), rg: .86, nd: true, em: true });
    }

    const nativeWater = K.procedural.waterBodies;
    const water = nativeWater.scene([nativeWater.create({
      id: HARBOR_WATER, bounds: { min: [-15,-12], max: [15,12] }, resolution: [64,64],
      sample(x,z) {
        if (channel(x,z) > 0 || coast(x,z) > .25) return null;
        return { bed: waterY - (.94+.95*(1-landing(x,z))), surface: waterY };
      },
      optics: HARBOR_WATER_OPTICS
    })]);
    const world = B.finish({
      water,
      cam: { target: [.02, 5.52, -.28], dist: 38.8, yaw: .30, pitch: .29, sway: 0, zoomIn: .14, zoomOut: 3.2, minPitch: -.24, maxPitch: 1.49 },
      detail: 18, radius: 21.5, dither: .18, palName: 'Afterimage Harbor',
      fog: { c: 56, start: .58, max: .40 },
      look: {
        pixel: true, pixelBudget: 225000, pointSplats: true, fixedPixelGrid: true, clean: false, damp: false,
        native: true, outline: { gap: .18 }, lines: { gap: .17 },
        coverageAware: true, renderStages: afterimageRenderStages(), optics: afterimageOptics()
      }
    });
    if (spriteAtlas) world.spriteSurfaces = spriteAtlas.finish();
    world.spatialGrade = afterimageWetGrade(channel, n3, seed, smooth, lanterns);
    world.surfaceEffects = SpatialGrade.context(world.spatialGrade, world.surfaceEffects);
    const inkFootprint = InkVeil.footprint([-13.4,-10.8,13.4,11.2], 256,
      (x,z) => Math.min(.65-coast(x*.94,z*.944),Math.max(-channel(x,z),coast(x,z)+.10)));
    // Leave the optical colors visible where the quay lights reach the
    // shallow service landing. The citywide reveal still applies here.
    const [x0,z0,x1,z1] = inkFootprint.bounds, { size, data } = inkFootprint;
    for (let i = 0; i < data.length; i++) {
      const x = x0+(i%size+.5)*(x1-x0)/size, z = z0+(Math.floor(i/size)+.5)*(z1-z0)/size;
      const open = Math.max(landing(x,z)*.97, .80*(1-smooth(.40,1.52,Math.hypot(x-ford(z)+.80,z-3.88))));
      data[i] = Math.round(data[i]*(1-open));
    }
    world.harborMotion = {
      TX, TZ, FOOT, c, s, parts, ad, adStart, iris, irisRange, sails, receiverGuides, traffic, boatAt,
      boatStart, boatEnd, waterStart, waterEnd, bedStart, bedEnd, reflectionStart, reflectionEnd, bodyStart, bodyEnd,
      inkFootprint,
      signs: { westScreen, eastScreen, label, redPylon, bluePylon, marketSign }
    };
    return world;
  }

  function afterimageRelayReveal(keys, period) {
    if (typeof InkVeil === 'undefined' || !InkVeil.flow) return null;
    const distortion = .72;
    const lead = InkVeil.flow(keys, { period, delay: .18, rise: 1.04, wake: .89, distortion });
    const banks = [
      { at: [-4.58,4.38,.52], extent: [13.35,10.35,14.45], delay: 1.26, rise: 2.37, strength: .89 },
      { at: [4.62,4.85,.04], extent: [13.45,10.15,14.10], delay: 1.93, rise: 2.52, strength: .87 }
    ];
    const tracks = [{ flow: lead, strength: 1 }, ...banks.map(({ at,extent,delay,rise,strength }) => ({
      flow: InkVeil.flow([{ time: 0,at,extent },{ time: period*.5,at,extent }],
        { period,delay,rise,wake: 0,distortion }),
      strength
    }))];
    const size = tracks.reduce((sum,track) => sum + track.flow.sample(0).centers.length,0);
    const frame = { centers: new Float32Array(size), extents: new Float32Array(size), warp: new Float32Array(2), settled: 0 };
    let lastTime;
    return {
      duration: Infinity,
      sample(seconds) {
        if (seconds === lastTime) return frame;
        lastTime = seconds;
        let offset = 0;
        for (const { flow,strength } of tracks) {
          const lobe = flow.sample(seconds);
          frame.centers.set(lobe.centers,offset);
          frame.extents.set(lobe.extents,offset);
          for (let i = 3; i < lobe.centers.length; i += 4) frame.centers[offset+i] *= strength;
          offset += lobe.centers.length;
        }
        frame.warp.set(lead.sample(seconds).warp);
        return frame;
      },
      coverage(seconds, point) {
        let visible = 0;
        for (const { flow,strength } of tracks) visible = Math.max(visible,flow.coverage(seconds,point)*strength);
        return visible;
      }
    };
  }

  function animateAfterimageHarbor(world, seed) {
    const K = KIT, { V } = K;
    const { TAU, smooth, waterY, ford, duration } = afterimageWater();
    const {
      TX, TZ, FOOT, c, s, parts, ad, adStart, iris, irisRange, sails, receiverGuides, traffic, boatAt,
      boatStart, boatEnd, waterStart, waterEnd, bedStart, bedEnd, reflectionStart, reflectionEnd, bodyStart, bodyEnd, inkFootprint, signs
    } = world.harborMotion;
    delete world.harborMotion;
    const { westScreen, eastScreen, label, redPylon, bluePylon, marketSign } = signs;
    const f = (x, y, z) => [TX + x * c + z * s, FOOT + y, TZ - x * s + z * c];
    const artRange = range => range.map(index => adStart + index);
    const rings = K.ripple.field({
      amplitude: .61, scale: .49, width: .82, speed: 2.68, damping: .32, capacity: 6,
      drops: [
        { at: [ford(-1.71) + .11, waterY, -1.71], start: .42, repeat: 2.64, strength: .71 },
        { at: [ford(3.81) - .67, waterY, 3.81], start: 1.10, repeat: 2.12, strength: .56 },
        { at: [boatAt[0] - .29, waterY, boatAt[2] - 1.14], start: 0, repeat: 2.6, strength: .77 },
        { at: [ford(8.27) + .29, waterY, 8.27], start: 1.94, repeat: 2.9, strength: .53 }
      ]
    });
    const stage = K.stage(world), D = world.data, rest = stage.base;
    const phaseAt = elapsed => ((elapsed % duration) + duration) % duration;
    const relative = time => time - (stage.t0 ?? time);
    const sceneTime = time => phaseAt(relative(time));
    const shutter = t => smooth(12.16, 13.72, t) * (1 - smooth(15.96, 17.24, t));
    const opacity = t => 1 - .89 * shutter(t);
    const wave = t => .57 * smooth(11.66, 12.42, t) * (1 - smooth(13.15, 13.73, t));
    const inspections = [
      { start: 3.50, end: 6.12, at: [-7.02, 3.65, -.68], size: [1.64,.76,.25], front: [.26,0,.97], left: .759,
        id: '07', name: 'コイ', note: 'KOI RELAY', shades: ['#070812','#3d1630','#a42a31','#ff8055','#ffd1a0'] },
      { start: 7.68, end: 10.42, at: [8.50, 5.21, 3.87], size: [1.05,.91,.22], front: [.39,0,.92], left: .051,
        id: '13', name: 'レーダー', note: 'ARCHIVE RADAR', shades: ['#050b19','#102a45','#12677d','#55d9e7','#d2fcff'] },
      { start: 13.64, end: 16.18, at: f(0, 3.76, .53), size: [1.68,1.12,.25], front: [s,0,c], left: .759,
        id: '31', name: 'シンゴウ', note: 'ROOF SIGNAL', shades: ['#0b1027','#361535','#993755','#fa7660','#ffdfa5'] }
    ];
    const relayInk = afterimageRelayReveal([
      { time: 0, at: [boatAt[0], .20, boatAt[2] - .68], extent: [4.7,3.7,5.8] },
      { time: 1.35, at: [ford(4.42) - .20, .64, 4.42], extent: [7.3,4.6,7.6] },
      { time: 2.68, at: [-4.35, 2.24, 3.08], extent: [11.5,7.7,10.8] },
      { time: 4.21, at: [-5.48, 3.93, -.16], extent: [14.6,10.4,13.2] },
      { time: 6.42, at: [-.76, 4.83, -.54], extent: [20.0,13.0,16.5] },
      { time: 8.84, at: [6.00, 4.79, 2.68], extent: [14.5,10.1,12.5] },
      { time: 10.90, at: [1.06, 5.36, -.61], extent: [19.3,12.8,15.6] },
      { time: 12.37, at: f(.45, 1.23, 1.22), extent: [14.8,10.5,13.2] },
      { time: 14.82, at: [.54, 5.56, -1.02], extent: [20.4,13.9,16.6] },
      { time: 16.62, at: f(.30, 1.88, .72), extent: [15.8,10.4,12.8] },
      { time: 17.76, at: [ford(4.80), .52, 4.80], extent: [6.8,5.2,7.1] }
    ],duration);
    const envelope = (t, from, to, fade) => smooth(from, from + fade, t) * (1 - smooth(to - fade, to, t));
    world.reflectivePool = {
      ranges: new Int32Array([waterStart,waterEnd,reflectionStart,reflectionEnd]),
      level: waterY, ellipse: [-1.1,.6,12.81,10.4], ripple: rings, time: relative,
      reflection: HARBOR_MIRROR, linked: true,
      transmission: { medium:HARBOR_WATER, range:[bedStart,bedEnd], optics:HARBOR_WATER_OPTICS },
      charge: time => .11 + .08 * shutter(phaseAt(time))
    };
    if (inkFootprint) {
      const pulse = new Float32Array(4);
      world.inkVeil = {
        footprint: inkFootprint, settings: [waterY, .021, .179, .96],
        autoReveal: true,
        reveal: relayInk || undefined,
        cyan: [.12,.78,.94], warm: [1,.16,.10],
        sources: new Float32Array([
          ford(-2.2), -2.2, 2.64, .54, ford(2.15)+.22, 2.15, 2.94, .73,
          ford(5.86)+.53, 5.86, 2.34, .63, ford(8.48)-.34, 8.48, 1.61, .65,
          ford(.43)-1.22, .43, 2.25, -.69, ford(6.72)-1.42, 6.72, 1.93, -.52
        ]),
        pulse(time) {
          const centers = relayInk ? relayInk.sample(Math.max(0, relative(time))).centers : null;
          const z = centers ? centers[2] : boatAt[2];
          pulse[0] = ford(z) + .24;
          pulse[1] = z;
          pulse[2] = centers ? .94 * centers[3] * (1 - smooth(1.2, 3.8, centers[1])) : 0;
          pulse[3] = time;
          return pulse;
        }
      };
    }
    const rig = K.puppet(world, {
      parts,
      pose(time, dt, p) {
        const t = phaseAt(time), reach = envelope(t, 11.60, 13.85, .63);
        const lower = smooth(2.48, 4.15, t) * (1 - smooth(5.74, 7.16, t));
        const drift = Math.sin(t * TAU / duration), flutter = Math.sin(t * TAU / duration * 3);
        p.pose.hips = { pos: [-.16 * reach, .19 * reach + .09 * drift, 0],
          rot: [0, -8 * reach, -3.6 * reach + 2 * drift] };
        p.pose.chest = { rot: [3 * reach, -7 * reach, -6 * reach] };
        p.pose.head = { rot: [4 + 10 * reach, -14 * reach + 36 * lower, -7 * reach + 4 * flutter] };
        p.pose.fringe = { rot: [4 * flutter, 10 * flutter, (7 + 4 * reach) * flutter] };
        p.pose.reachArm = { rot: [-12 * lower, 10 * reach, -55 * reach] };
        p.pose.reachForearm = { rot: [-28 * reach, -12 * reach, -27 * reach] };
        p.pose.reachHand = { rot: [-10 * reach, -20 * reach, 24 * reach] };
        p.pose.otherArm = { rot: [9 * reach, 3 * flutter, -8 * reach - 7 * lower] };
        p.pose.otherForearm = { rot: [13 * lower, 5 * reach, 12 * lower] };
        p.pose.otherHand = { rot: [-6 * flutter, 0, -7 * lower] };
        p.pose.leftLeg = { rot: [-8 * reach, 0, 4 * drift] };
        p.pose.leftShin = { rot: [22 * lower, 0, -4 * reach] };
        p.pose.rightLeg = { rot: [-10 * lower, 0, -8 * drift - 7 * reach] };
        p.pose.rightShin = { rot: [18 * reach, 0, 4 * lower] };
        p.pose.coatLeft = { rot: [-22 * reach - 6 * flutter, -10 * drift, -9 * flutter - 3 * reach] };
        p.pose.coatRight = { rot: [23 * reach + 11 * flutter, 17 * reach, 20 * reach + 7 * flutter] };
      }
    });
    const body = Object.values(parts).flatMap(part => part.ids);
    const projection = [.21, .70, .178, .72];
    const encoded = world.pal.map(rgb => ((rgb >>> 16) & 255) | (rgb & 0xff00) | ((rgb & 255) << 16));
    let lastSignFrame = -1;
    const stageEffect = {
      update(dt, elapsed) {
        const t = phaseAt(elapsed), turn = t / duration * TAU, phase = shutter(t), fade = opacity(t), change = wave(t);
        const wash = Math.sin(elapsed * TAU / 2.6);
        for (let i = boatStart; i < boatEnd; i++) {
          D[i * 16 + 1] = rest[i * 16 + 1] + wash * .054;
          stage.touch(i);
        }
        for (const { first, end, sign, offset } of traffic) {
          const u = (elapsed / 15.3 + offset) % 1;
          const alpha = smooth(.016, .09, u) * (1 - smooth(.88, .98, u));
          const advance = (u * 24.8) * sign;
          for (let i = first; i < end; i++) {
            const q = i * 16;
            D[q] = rest[q] + advance;
            D[q + 1] = rest[q + 1] + .32 * Math.sin(u * TAU);
            D[q + 2] = rest[q + 2] + .86 * Math.sin(u * Math.PI);
            D[q + 3] = rest[q + 3] * alpha;
            stage.touch(i);
          }
        }
        if (!stage.gpuSignal) for (const i of body) {
          const offset = i * 16, row = Math.floor(rest[offset + 1] * 17), tick = Math.floor(t * 16);
          const gate = K.hash(row, tick, seed);
          const ripple = .94 + .06 * Math.sin(rest[offset + 1] * 30 - t * 16);
          const shear = change * (gate > .72 ? .52 * Math.sin(row * .81 + t * 17) : 0);
          D[offset] = rest[offset] + c * shear;
          D[offset + 2] = rest[offset + 2] - s * shear;
          const p = rest[offset + 1] / projection[2] - t * projection[3];
          const band = 1 - smooth(.10, .32, Math.abs(p - Math.floor(p) - .5));
          D[offset + 3] = Math.min(.5, rest[offset + 3] * fade * ripple) * (.12 + .27 * band) *
            (gate > .93 - change * .26 ? .28 + .48 * (1 - change) : 1);
          stage.touch(i);
        }
        for (const { i, x, y, r, row, col, ink } of iris) {
          const theta = .16 * Math.sin(turn * 3) * smooth(1.38, 1.02, r);
          const scan = .88 + .16 * Math.sin(r * 17 - t * 15);
          const xxx = x + y * theta, yyy = y - x * theta;
          const p = f(xxx, 3.76 + yyy, .31 + .12 * Math.sin(r * 6 - t * 4));
          D[i] = p[0]; D[i + 1] = p[1]; D[i + 2] = p[2];
          D[i + 3] = phase * scan * (K.hash(row, Math.floor(t * 16), seed) > .95 ? .3 : 1.65);
          D[i + 7] = encoded[Math.min(22, ink + (K.hash(col, row, seed + 31) > .76 ? 1 : 0))];
          stage.touch(i / 16);
        }
        for (const { i, a, b, c: n } of sails) {
          const t2 = (a + elapsed * (.142 + b * .085)) % 1;
          const x = (b - .5) * (2.5 + 3.85 * change) * t2, y = 6.83 * t2;
          const p = f(x + .33 * Math.sin(t2 * 8 + n * 8), y, (n - .5) * 1.47 * t2);
          D[i] = p[0]; D[i + 1] = p[1]; D[i + 2] = p[2];
          D[i + 3] = Math.sin(t2 * Math.PI) * (.19 + .55 * change) * (.47 + .53 * n);
          stage.touch(i / 16);
        }
        for (const { i, angle, radius, major } of receiverGuides) {
          const theta = angle + turn * .98, spark = Math.max(0, Math.cos(theta * 3 - turn * 4)) ** 10;
          const p = f(Math.cos(theta) * radius, 3.37 + .82 * Math.sin(theta) * radius,
            -.44 + .19 * Math.sin(theta * 2));
          D[i] = p[0]; D[i + 1] = p[1]; D[i + 2] = p[2];
          D[i + 3] = .07 + .43 * spark * (major ? 1.24 : .59) + phase * .18;
          D[i + 7] = encoded[phase > .6 ? major ? 20 : 38 : major ? 35 : 32];
          stage.touch(i / 16);
        }
        const clock = Math.floor(t * 18);
        if (clock === lastSignFrame) return;
        lastSignFrame = clock;
        for (const {i, u, v, kind, across, q, w, h, code} of ad) {
          const flicker = K.hash(Math.floor(v * 71), clock, seed);
          const tear = flicker > .87 && (
            (kind === 'koi' && t > 4.89 && t < 5.08) || (kind === 'spectrum' && t > 9.78 && t < 9.94)
          );
          const hot = kind === 'koi' || kind === 'port-tower' || kind === 'night-market' || kind === 'quay-red';
          const sweep = Math.abs(v - (turn * .48 + (hot ? .43 : .11)) % 1) < .041;
          const fish = kind === 'koi' && v >= .21;
          const dx = fish ? Math.sin(turn * 2) * .09 * w : 0;
          const dy = fish ? Math.max(0, (u - .35)) * .184 * h * Math.sin(turn * 5 - u * 8.3) : 0;
          const shift = dx + (tear ? (flicker - .7) * .19 * w : 0);
          D[i] = q[0] + across[0] * shift; D[i + 1] = q[1] + dy; D[i + 2] = q[2] + across[2] * shift;
          const angle = Math.atan2(v - .562, (u - .5) * 1.15), diff = Math.cos(angle - turn * 4);
          const active = kind === 'spectrum' && v > .23 && diff > .8;
          D[i + 3] = active || sweep ? 2.55 : (kind === 'spectrum' && v > .23) ? .91 : tear ? .68 : 1.94;
          D[i + 7] = encoded[tear ? hot ? 40 : 35 : active ? 35 : sweep ? hot ? 21 : 60 : code];
          stage.touch(i / 16);
        }
      }
    };
    stage.add(stageEffect);
    stage.gpuSignal = true;
    stageEffect.update(0, 0);
    stage.gpuSignal = false;
    stage.resetClock = time => {
      stage.t0 = time;
      lastSignFrame = -1;
    };
    stage.stateful = false;
    world.cull = { mutable: [[waterStart, waterEnd], [boatStart, boatEnd], [bodyStart, bodyEnd],
      [adStart, adStart + ad.length], [reflectionStart, world.count]] };
    world.signal = {
      range: [bodyStart, bodyEnd], axis: [c, -s], projection,
      frame(time) {
        const t = sceneTime(time);
        return [t, opacity(t), wave(t)];
      }
    };
    world.glass = {
      mode: 'gaps', at: [0, 3.5, -.45], r: 14.55, floor: waterY - .35, dir: V.norm([.16,-.98,.19]),
      gaps: [[TX-.55, 5.86, TZ-.34, .38], [TX+.64, 5.85, TZ+.49, .33],
        [-8.67, 6.92, -3.91, .81], [-6.27, 3.55, .32, .73], [8.26, 6.02, 3.82, .77],
        [-.51, 8.33, -6.74, .56]],
      cols: [35,34,19,40,34,32], steps: 15, softness: .94,
      k: time => .56 + .10 * shutter(sceneTime(time))
    };
    const scanFrames = new WeakMap();
    const revealAt = (context, point) => context.revealElapsed == null || !relayInk ? 1 :
      relayInk.coverage(context.revealElapsed, point);
    const scanOpacity = (start, end, peak) => ({
      loop: duration, ease: 'smooth', keys: [[start, 0], [start + .52, peak], [end - .52, peak], [end, 0]]
    });
    function targetBounds(context, target) {
      const bounds = context.project.bounds({ min: V.sub(target.at, target.size), max: V.add(target.at, target.size) });
      const front = context.project.point(V.add(target.at, target.front));
      if (!bounds?.complete || !front || front[2] >= bounds.at[2] - .00002) return null;
      const [x, y] = bounds.at;
      return x > .08 && x < .92 && y > .11 && y < .88 ? bounds : null;
    }
    function readout(context) {
      if (scanFrames.has(context)) return scanFrames.get(context);
      const t = sceneTime(context.sceneTime);
      const target = inspections.find(({ start, end }) => t > start && t < end);
      let frame = null;
      if (target && revealAt(context, target.at) > .18) {
        const bounds = targetBounds(context, target);
        if (bounds) {
          const [x,y,w,h] = bounds.rect;
          const rect = [target.left, .123, .19, .176];
          const ratio = rect[2] / rect[3], sw = Math.max(w, h * ratio) * 1.17, sh = sw / ratio;
          const source = [x + (w - sw) / 2, y + (h - sh) / 2, sw, sh];
          const overlapsPanel = x < rect[0] + rect[2] && x + w > rect[0] && y < rect[1] + rect[3] && y + h > rect[1];
          if (!overlapsPanel && sw < rect[2] * .94 && source[0] >= 0 && source[1] >= 0 &&
              source[0] + sw <= 1 && source[1] + sh <= 1) {
            frame = { target, bounds, rect, source, opacity: envelope(t, target.start, target.end, .52) };
          }
        }
      }
      scanFrames.set(context, frame);
      return frame;
    }
    const annotationColor = '#b5e4ef';
    const readoutOpacity = ctx => readout(ctx)?.opacity || 0;
    const screenRect = ctx => readout(ctx)?.rect;
    const footerAt = ctx => {
      const rect = screenRect(ctx);
      return rect && [rect[0], rect[1] + rect[3]];
    };
    const readoutEdge = ctx => {
      const scan = readout(ctx);
      if (!scan) return null;
      const [x, y, w, h] = scan.rect;
      return [x < .5 ? x + w : x, y + h * .60];
    };
    const courierBounds = { min: [TX - 4.0, FOOT - .3, TZ - 3.2], max: [TX + 4.0, FOOT + 6.4, TZ + 3.2] };
    const eyeTarget = inspections[2];
    const irisBounds = { min: V.sub(eyeTarget.at, [2.9, 1.5, 1.7]), max: V.add(eyeTarget.at, [2.9, 1.5, 1.7]) };
    const kana = kanaGlyphs;
    const relayClock = { loop: duration };
    const scanPoint = ctx => readout(ctx)?.bounds.at;
    const radarPing = inspections[1].start + .63;
    const keyframes = keys => ({ ease: 'smooth', keys });
    const standby = inspections.flatMap(target => {
      const opacity = ctx => readout(ctx) ? 0 :
        .32 * envelope(sceneTime(ctx.sceneTime),target.start - 1.02,target.start,.44) * revealAt(ctx, target.at);
      return [
        { kind: 'corners', rect: ctx => targetBounds(ctx, target)?.rect, color: '#7493a8',
          size: 4, width: .8, opacity, occlusion: 'overlay' },
        { kind: 'label', at: ctx => {
          const bounds = targetBounds(ctx, target);
          return bounds && [bounds.rect[0], bounds.rect[1]];
        }, text: target.id + ' ' + target.name, color: '#8aa8b8', offset: [0, -11], scale: 1.03, opacity, occlusion: 'overlay' }
      ];
    });
    world.renderEffects = {
      groups: [
        { indices: body, object: 'courier' },
        { range: irisRange, object: 'iris' },
        { range: artRange(westScreen), object: 'koi-screen' },
        { range: artRange(eastScreen), object: 'radar-screen' },
        { range: artRange(label), object: 'tower-caption' },
        { range: artRange(redPylon), object: 'port-tower' },
        { range: artRange(bluePylon), object: 'archive-tower' },
        { range: artRange(marketSign), object: 'night-market' }
      ],
      point: (name, point) => rig.point(name, point),
      annotationGlyphs: kana,
      annotations: [
        ...standby,
        { kind: 'corners', rect: ctx => readout(ctx)?.bounds.rect, color: annotationColor, padding: 4,
          size: 10, width: 1.05, opacity: ctx => .89 * readoutOpacity(ctx), occlusion: 'overlay' },
        { kind: 'crosshair', at: ctx => readout(ctx)?.target.at, color: annotationColor,
          size: 8, gap: 3, width: 1, opacity: ctx => .49 * readoutOpacity(ctx), occlusion: 'overlay' },
        { kind: 'line', points: [
          ctx => {
            const scan = readout(ctx);
            if (!scan) return null;
            const [x,y,w,h] = scan.bounds.rect;
            return [scan.rect[0] < .5 ? x : x + w, y + h * .53];
          }, readoutEdge
        ], color: annotationColor, width: .8, opacity: ctx => .36 * readoutOpacity(ctx), occlusion: 'overlay' },
        { kind: 'corners', rect: screenRect, color: annotationColor, size: 12, width: 1.3,
          opacity: readoutOpacity, occlusion: 'overlay' },
        { kind: 'label', at: ctx => screenRect(ctx)?.slice(0, 2), text: ctx => {
          const target = readout(ctx)?.target;
          return target && target.id + ' / ' + target.name;
        }, color: '#e2f5ff', background: '#111825', offset: [0, -18], scale: 1.65,
          opacity: readoutOpacity, occlusion: 'overlay' },
        { kind: 'label', at: footerAt, text: ctx => readout(ctx)?.target.note,
          color: annotationColor, background: '#111825', offset: [0, 4], scale: 1.05,
          opacity: ctx => .83 * readoutOpacity(ctx), occlusion: 'overlay' }
      ],
      layers: [
        { effect: 'glitch', target: { object: 'courier' }, bounds: courierBounds, variant: 'rows', block: [14,3], offset: [8,1],
          cadence: 11, chance: .35, spill: true, clock: relayClock,
          opacity: keyframes([[12.51,0],[12.68,.45],[12.88,.31],[13.16,0]]) },
        { effect: 'glow', target: { object: 'iris' }, bounds: irisBounds,
          gain: .29, radius: 3, threshold: .45, spill: true, clock: relayClock,
          opacity: keyframes([[13.14,0],[14.0,.35],[15.60,.35],[16.92,0]]) },
        { effect: 'glyphs', space: 'screen', target: { rect: ctx => {
          const point = scanPoint(ctx);
          return point && [point[0] - .126, point[1] - .177, .252, .354];
        } }, set: '  0137:.+*%#/コイナミヒカリ', glyphs: kana, cell: [6, 8], gap: [0, 0],
          cutoff: .028, refresh: 7, palette: ['#102743','#397889','#94dfe9','#dffcff'],
          inputRange: [.034, .56], blend: 'screen', clock: relayClock,
          opacity: keyframes([[radarPing,0],[radarPing+.12,.40],[radarPing+.39,.21],[radarPing+.66,0]]),
          wave: { at: scanPoint, radius: keyframes([[radarPing,.012],[radarPing+.58,.119]]), width: .026 } },
        { effect: 'glitch', space: 'screen', variant: 'blocks', block: [27, 9], offset: [9, 2],
          cadence: 12, chance: .24, clock: relayClock,
          opacity: keyframes([[12.06,0],[12.16,.30],[12.28,.24],[12.44,0]]) },
        ...inspections.map(target => ({
          effect: 'inset', target: { rect: ctx => readout(ctx)?.target === target ? screenRect(ctx) : null },
          sourceRect: ctx => readout(ctx)?.source, palette: target.shades, inputRange: [.012, .76],
          when: { start: target.start, every: duration, duration: target.end - target.start },
          opacity: scanOpacity(target.start, target.end, .88)
        }))
      ]
    };
    return world;
  }

  return { id: 'afterimage-harbor', name: 'Afterimage Harbor', seed: 1307, build: sceneAfterimageHarbor, animate: animateAfterimageHarbor };
}

if (typeof module !== 'undefined') module.exports = rebirthAfterimageHarbor;
