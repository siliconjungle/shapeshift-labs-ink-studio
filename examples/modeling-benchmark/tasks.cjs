'use strict';

const path = require('node:path');
const { isDeepStrictEqual: equal } = require('node:util');
const portal = require('../gatehouse-revision/portal.cjs');
const gateReview = require('../gatehouse-revision/demo.cjs');
const { pose } = require('../../cli/diarama-pose.js');
const R = require('../../cli/render.js');
const PNG = require('../../cli/png.js');
const { readDepthInput } = require('../../cli/depth.js');
const { scanFusion } = require('../../cli/scan-fusion.js');

const grid = { width: 160, height: 104 };
const standardViews = [{ id:'front', yaw:-.06 }, { id:'left', yaw:-.37 }, { id:'right', yaw:.39 }];
const identity = [1,0,0,0,1,0,0,0,1,0,0,0];
const check = (id, pass, evidence) => ({ id, pass, evidence });
const signature = (...values) => JSON.stringify(values);
const object = (ink, source) => ink.createSceneEditor(source).meshTopology(portal.object);

function paint(before, after, measuredOnly = false) {
  const {width, height, pixels} = before;
  const sameGrid = after?.width === width && after.height === height && after.pixels?.length === pixels.length;
  let protectedTexels = 0, retainedTexels = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (measuredOnly && !pixels[i+3]) continue;
    protectedTexels++;
    if (sameGrid && [0,1,2,3].every(channel => pixels[i+channel] === after.pixels[i+channel])) retainedTexels++;
  }
  return { protectedTexels, retainedTexels };
}

function frameOptions(view, extra = {}) {
  return { w:grid.width, h:grid.height, px:1, t:0, lockCamera:true, cameraGuides:false,
    shutter:false, renderGrid:false, yaw:view.yaw, pitch:view.pitch ?? .16, ...extra };
}

function meshAnchors(row, ids) {
  const faces = new Map(row.document.faces.map(face => [face.id, face]));
  const vertices = new Map(row.document.vertices.map(vertex => [vertex.id, vertex.position]));
  return new Map((row.bindings ?? []).filter(binding => ids.includes(binding.id)).flatMap(binding => {
    const face = faces.get(binding.element);
    return face && face.corners.every(corner => vertices.has(corner.vertex)) && !['lost','invalid','unbound'].includes(binding.status)
      ? [[binding.id, signature(face.material,face.corners.map(corner => [corner.uv,vertices.get(corner.vertex)]))]] : [];
  }));
}

function gatehouseWorld(ink, source) {
  const kit = ink.load();
  const example = require('../opaque-surface-gate.js')(kit);
  const world = example.build(example.seed, { sdfPortal:false });
  const t = 3*Math.PI/1.8;
  pose(world, t, {kit});
  world.meshes = ink.createSceneEditor(source).build().meshes;
  const options = view => frameOptions(view, {t, passes:['materialId']});
  return {
    render: view => R.render(world, options(view)),
    clearance: view => gateReview.footprint(R.render({...world, meshes:[...world.meshes,gateReview.witness(kit.KIT)]},
      {...options(view),passes:['objectId']}), 'exit-clearance-probe', 'objectId').maxRun
  };
}

const gatehouse = {
  title:'Painted gatehouse',
  brief:'Widen the arched passage and bevel its front rim. Keep the TIDE sign, its registration, and the existing pigment atlas intact.',
  review:'Can you read the wider passage and continuous bevel from each angle? Check that the TIDE sign stays legible and fixed.',
  views:standardViews,
  source(ink) {
    const exemplar = require('../opaque-surface-gate.js')(ink.load());
    return gateReview.sourceScene(portal.portal(false),portal.atlas(),exemplar.build(exemplar.seed,{sdfPortal:false}).cam);
  },
  reference(ink, source) {
    const editor = ink.createSceneEditor(source);
    editor.editMeshTopology(portal.object,portal.editPatch(editor.meshTopology(portal.object).document,portal.portal(true)));
    return editor.snapshot();
  },
  async evaluate(ink, source, edited) {
    const a = object(ink,source), b = object(ink,edited), old = gatehouseWorld(ink,source), next = gatehouseWorld(ink,edited);
    const before = this.views.map(old.render), after = this.views.map(next.render);
    const clearance = this.views.map(view => ({view:view.id,before:old.clearance(view),after:next.clearance(view)}));
    const bevel = after.map(image => gateReview.footprint(image,portal.bevel,'materialId').pixels);
    const signs = before.map((image,i) => {
      const prior = gateReview.footprint(image,portal.sign,'materialId');
      const now = gateReview.footprint(after[i],portal.sign,'materialId');
      return prior.pixels >= 12 && equal(prior.mask,now.mask) && prior.mask.every((active,pixel) =>
        !active || [0,1,2].every(channel => image.rgb[pixel*3+channel] === after[i].rgb[pixel*3+channel]));
    });
    const texture = row => row.materials.find(material => material.id === portal.stone)?.texture;
    return {before,after,beforeBindings:meshAnchors(a,['sign-anchor']),afterBindings:meshAnchors(b,['sign-anchor']),
      paint:paint(texture(a),texture(b)),checks:[
        check('passage-width',clearance.every(row => row.after >= row.before+2),clearance),
        check('visible-bevel',bevel.every(n => n >= 8),bevel),
        check('sign-at-1x',signs.every(Boolean),signs)
      ]};
  }
};

function coilSource(ink) {
  const api = ink.load().KIT.curve.retained, z = .36;
  const positions = [[-2.175,.27,.36],[-1.24,.41,.45],[-.55,.05,.45],[0,.29,z],[.65,.58,.43],[1.30,.15,.44],[2.175,.27,.36]];
  const names = ['entry','lead','near','overpass','far','return','exit'];
  const points = positions.map((position,i) => ({ id:names[i], position, radius:.073,
    inHandle:[i === 0 ? 0 : -.21,0,0], outHandle:[i === names.length-1 ? 0 : .21,0,0]}));
  const segments = names.slice(1).map((to,i) => ({id:names[i]+'-'+to,from:names[i],to}));
  return { pigment:'#c17a56', route:api.create({format:api.format,version:1,id:'signal-coil-service',
    splines:[{id:'service-winding',points,segments}],
    attachments:[{id:'entry-socket',spline:'service-winding',segment:segments[0].id,t:0},
      {id:'exit-socket',spline:'service-winding',segment:segments.at(-1).id,t:1}]}) };
}

function windingAnchors(api, route) {
  return new Map(api.inspect(route).attachments.map(row => [row.id,signature(row.p.map(n => Math.round(n*1e5)))]));
}

function coilGap(api, route) {
  const samples = route.splines.flatMap(spline => {
    const curve = api.compile(route,spline.id);
    return spline.segments.flatMap(segment => Array.from({length:65},(_,i) => curve.anchor(segment.id,i/64)));
  });
  const gaps = samples.flatMap(({p:[x,y,z],radius}) =>
    Math.abs(x) <= .16+radius && Math.abs(y-.31) <= .52+radius ? [z-.549-radius] : []);
  return gaps.length ? Math.min(...gaps) : null;
}

const coil = {
  title:'Signal coil',
  brief:'Reroute the middle copper winding over the teal service clamp with at least 0.06 world units of clearance. Keep the two socket endpoints and copper swatch.',
  review:'Does the middle winding read as one continuous cable with a clear gap over the teal clamp at each angle?',
  views:[{id:'front',yaw:-.23},{id:'left',yaw:-.51},{id:'right',yaw:.36,pitch:.25}],
  source:coilSource,
  reference(ink, source) {
    const api = ink.load().KIT.curve.retained;
    const {document:route} = api.plan(source.route,{revision:api.revision(source.route),operations:[
      {op:'set-point',point:'overpass',position:[0,.29,.82],radius:.073}
    ]});
    return {...source,route};
  },
  async evaluate(ink, source, edited) {
    if (typeof edited.pigment !== 'string' || !/^#[0-9a-f]{6}$/i.test(edited.pigment))
      throw new TypeError('Signal coil needs a six-digit copper swatch');
    const kit = ink.load(), api = kit.KIT.curve.retained, example = require('../curve-mode-signal-coil.js')(kit);
    const render = data => {
      const world = example.build(example.seed,{serviceWinding:{...data,route:api.create(data.route)}});
      return this.views.map(view => R.render(world,frameOptions(view,{t:1.8,curveMode:'curves'})));
    };
    const gap = coilGap(api,edited.route);
    const beforeBindings = windingAnchors(api,source.route), afterBindings = windingAnchors(api,edited.route);
    const route = api.create(edited.route);
    const intact = route.splines.length === 1 && route.attachments.length === 2 &&
      route.attachments.every(row => row.spline === route.splines[0].id);
    return {before:render(source),after:render(edited),beforeBindings,afterBindings,
      paint:{protectedTexels:0,retainedTexels:0,protectedSwatches:1,
        retainedSwatches:Number(source.pigment.toLowerCase() === edited.pigment.toLowerCase())},
      checks:[check('clamp-clearance',gap !== null && gap >= .06,{before:coilGap(api,source.route),after:gap,minimum:.06}),
        check('continuous-route',intact,{splines:route.splines.length,sockets:route.attachments.length})]};
  }
};

function scanInput(base, views) {
  return views.map(view => ({id:view.id, weight:view.weight, pose:view.pose,
    capture:readDepthInput(path.join(base,view.depth),{image:path.join(base,view.image)})}));
}

function scanAnchors(result) {
  const faces = new Map(result.proxy.faces.map(face => [face.id,face]));
  return new Map(result.evidence.faces.filter(row => row.status !== 'approved-fill').map(row =>
    [row.id, signature(row.primary,faces.get(row.id).corners.map(corner => corner.uv))]));
}

function raster(bytes) {
  const {w:width,h:height,data:pixels} = PNG.raster(bytes);
  return {width,height,pixels};
}

const scan = {
  title:'Captured harbor hatch',
  brief:'Fill the unmeasured brass lintel patch with an approved insert on the front plane. Protect the enamel capture, measured face bindings, and the hatch opening.',
  review:'Does the brass insert close the damaged patch convincingly? Check the threshold stays open and the measured paint reads coherently around the repair.',
  fixture:'Synthetic registered RGB-D capture with deliberate missing and conflicting measurements.',
  views:standardViews,
  source(_ink, dir) {
    const {measured} = require('../registered-scan-fusion.cjs').writeCaptures(dir,{writeManifests:false});
    return measured;
  },
  reference(_ink, source) {
    const [insert] = require('../registered-scan-fusion.cjs').approvedFills();
    const vertices = [[.146,.806,.42],[.761,.806,.42],[.761,1.002,.42],[.146,1.002,.42]];
    return {...source,fills:[{...insert,vertices}]};
  },
  async evaluate(ink, source, edited, directory) {
    if (!equal(edited.views,source.views) || !equal(edited.bounds,source.bounds) ||
        edited.format !== source.format || edited.version !== source.version)
      throw new RangeError('Keep the starting scan views and reconstruction bounds');
    const views = scanInput(directory,source.views), kit = ink.load();
    const fuse = doc => scanFusion(views,{...doc.options,name:source.name,bounds:source.bounds,fills:doc.fills,toolkit:kit});
    const a = await fuse(source), b = await fuse(edited);
    const options = view => frameOptions(view,{ortho:true,target:[0,0,0],dist:4.7,fov:.62});
    const frames = async result => {
      const world = await result.world();
      return this.views.map(view => R.render(world,options(view)));
    };
    const mesh = await b.world('mesh'), rays = mesh.meshes.map(part => kit.KIT.sceneMeshes.rayQuery(part,kit.KIT));
    const hits = (x,y) => rays.map(trace => trace({origin:[x,y,2],direction:[0,0,-1],maxDistance:3})).filter(Boolean);
    const samples = [.20,.33,.47,.62,.71].map(x => hits(x,.90).some(hit => Math.abs(hit.distance-1.58)<.07));
    const aperture = [-.35,0,.35].every(x => hits(x,.14).length === 0);
    return {before:await frames(a),after:await frames(b),
      beforeBindings:scanAnchors(a),afterBindings:scanAnchors(b),paint:paint(raster(a.atlas),raster(b.atlas),true),
      checks:[check('approved-lintel',samples.every(Boolean) && b.report.faces['approved-fill'] > 0,
        {samples,approvedFaces:b.report.faces['approved-fill']}),
        check('open-aperture',aperture,{sampleCount:3})]};
  }
};

const sections = [-1.61,-1.36,-1.09,-.81,-.52,-.27,-.06,.16,.36,.59,.83,1.10,1.40,1.61];
const pivot = [.08,.06,0];
const sleeveViews = [{id:'rest',yaw:.09,angle:0},{id:'bend',yaw:.09,angle:1.18},{id:'tight',yaw:-.32,angle:1.48}];

function sleeveSource(ink) {
  const vertices = [], faces = [], sides = 12;
  for (const [i,x] of sections.entries()) {
    const radius = .44-(x-sections[0])*.041+(i===1||i===sections.length-2 ? .045 : 0);
    for (let j=0;j<sides;j++) {
      const theta = 2*Math.PI*j/sides;
      const elbow = Number(i >= 7);
      vertices.push({id:`ring-${i}/${j}`,position:[x,radius*Math.sin(theta),radius*Math.cos(theta)],
        weights:{upper:1-elbow,forearm:elbow}});
      if (i === 0) continue;
      const next = (j+1)%sides;
      const ring = [[i-1,j],[i,j],[i,next],[i-1,next]];
      const uv = [[i-1,j],[i,j],[i,j+1],[i-1,j+1]];
      const id = `band-${i}/${j}`;
      faces.push({id,material:'woven-sleeve',corners:ring.map(([r,k],corner) =>
        ({id:id+'/'+corner,vertex:`ring-${r}/${k}`,uv:[uv[corner][0]/(sections.length-1),uv[corner][1]/sides]}))});
    }
  }
  const width = 96, height = 48, pixels = [];
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const seam = y%12 < 1, thread = (x+2*y)%9<2;
    const cuff = x<12 || x>83, piping = [2,3,10,11,84,85,93,94].includes(x);
    const sigil = y%24>=10 && y%24<=15 && Math.abs(x-71)+Math.abs(y%24-12)<=5;
    const rgb = piping || sigil ? [237,179,110] : cuff ? [139+20*thread,80+12*thread,59] :
      seam ? [37,70,79] : [48+9*thread,115+14*thread,118+13*thread];
    pixels.push(...rgb,255);
  }
  const mesh = ink.load().KIT.meshTopology.create({id:'faraday-sleeve',vertices,faces,
    skin:{joints:['upper','forearm']}});
  return {mesh,texture:{width,height,pixels}};
}

function hinge(angle) {
  const c = Math.cos(angle), s = Math.sin(angle), [x,y] = pivot;
  return [c,-s,0,s,c,0,0,0,1,x-c*x+s*y,y-s*x-c*y,0];
}

function cuffs(doc) {
  const vertices = new Map(doc.vertices.map(row => [row.id,row]));
  const joints = doc.skin?.joints ?? [];
  return new Map(['upper','forearm'].flatMap((joint,i) => {
    const ring = i ? sections.length-1 : 0;
    const pins = Array.from({length:12},(_,j) => vertices.get(`ring-${ring}/${j}`));
    return joints.includes(joint) && pins.every(row => row?.weights?.[joint] === 1)
      ? [[joint+'-cuff',signature(pins.map(row => row.position))]] : [];
  }));
}

function sleeveSpikes(mesh, app) {
  const weights = new Map(app.skin.inspect(mesh).vertices.map(row => [row.id,row.effective?.forearm ?? 0]));
  const steps = Array.from({length:sections.length-1},(_,i) => Array.from({length:12},(_,j) => {
    const a = weights.get(`ring-${i}/${j}`), b = weights.get(`ring-${i+1}/${j}`);
    return a === undefined || b === undefined ? 1 : Math.abs(b-a);
  })).flat();
  return Math.max(...steps);
}

const sleeve = {
  title:'Rigged Faraday sleeve',
  brief:'Redistribute upper-arm and forearm weights around the elbow. Hold the rest shape, both cuff attachments, and the woven pattern. The bent sleeve should have a gradual fold.',
  review:'Does the sleeve bend without a sharp kink or a pinched opening? Compare the rest pose and both bends for intact cuffs and weave.',
  views:sleeveViews,
  source:sleeveSource,
  reference(ink, source) {
    const api = ink.load().KIT.meshTopology;
    const operations = [[4,.07],[5,.18],[6,.37],[7,.62],[8,.80],[9,.92]].map(([ring,weight]) =>
      ({op:'assign',joint:'forearm',weight,selection:api.select(source.mesh,{domain:'vertices',
        ids:source.mesh.vertices.filter(row => row.id.startsWith('ring-'+ring+'/')).map(row => row.id)})}));
    const {document:mesh} = api.skin.plan(source.mesh,{revision:api.revision(source.mesh),operations});
    return {...source,mesh};
  },
  async evaluate(ink, source, edited) {
    const {KIT:K,makeBuilder} = ink.load(), api = K.meshTopology;
    const a = api.create(source.mesh), b = api.create(edited.mesh);
    const render = (doc,texture) => this.views.map(view => {
      const rgba = {...texture,pixels:Uint8Array.from(texture.pixels)};
      const mesh = api.toSceneMesh(doc,{materials:[{id:'woven-sleeve',texture:rgba}]});
      if (doc.skin) api.skin.bind(mesh).pose(Object.fromEntries(doc.skin.joints.map(joint =>
        [joint,joint === 'forearm' ? hinge(view.angle) : identity])));
      const camera = {target:[-.04,.34,0],yaw:view.yaw,pitch:.18,dist:4.85,ortho:true,fov:.69};
      const world = makeBuilder(56,[0x233647]).finish({meshes:[mesh],cam:camera,radius:4,dither:0,
        fog:{c:0,start:1,max:0},liveSun:{direction:[-.42,.72,1],intensity:.56,ambient:.46,shadows:false}});
      return R.render(world,frameOptions(view,{camera,raw:true}));
    });
    const rest = doc => [doc.vertices.map(row => [row.id,row.position]),doc.faces];
    const jump = b.skin ? sleeveSpikes(b,api) : null;
    return {before:render(a,source.texture),after:render(b,edited.texture),beforeBindings:cuffs(a),afterBindings:cuffs(b),
      paint:paint(source.texture,edited.texture),
      checks:[check('rest-registration',equal(rest(a),rest(b)),{restVertices:b.vertices.length}),
        check('weight-transition',jump !== null && jump <= .34,{before:sleeveSpikes(a,api),after:jump,maximum:.34})]};
  }
};

module.exports = {grid,tasks:{gatehouse,'signal-coil':coil,'captured-prop':scan,'rigged-sleeve':sleeve}};
