const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');
const projection = require('./material-projection.js');

function prepare({bakeDir,paintViews,capturePaint}) {
  if (bakeDir===undefined && paintViews===undefined && capturePaint===undefined) return null;
  if(typeof bakeDir!=='string'||!bakeDir || paintViews!==undefined && capturePaint!==undefined)
    throw new TypeError('Registered baking needs a bake directory and one paint or capture plan at a time');
  const directory=path.resolve(bakeDir), meshes=[], output=new Map(), captures=[];
  const paint=projection.read(paintViews,'paint'), capture=projection.read(capturePaint,'camera');
  if (capture.length && (fs.existsSync(path.join(directory,'paint-views','approved.json')) ||
      capture.some(({id})=>fs.existsSync(path.join(directory,'paint-views',id+'-paint.png')))))
    throw new Error('Choose a fresh paint capture directory to preserve the existing paint files');
  function validate(count) {
    if([...paint,...capture].some(row=>row.mesh>=count))throw new RangeError('Material paint plan references a missing mesh index');
  }

  function record(index, mesh, faces, uvs, size, padding, baked, plan, kit) {
    const folder='mesh-'+String(index).padStart(3,'0'), {textures,registeredMaps,strength,coverage}=baked;
    function map(name,bytes,colorSpace) {
      const file=folder+'/'+name+'.png';
      output.set(file,bytes);
      return {file,colorSpace,sha256:projection.digest(bytes)};
    }
    const maps={
      pigment:map('pigment',textures.base,'sRGB'),
      normal:map('normal',textures.normal,'linear'),
      roughness:map('roughness',registeredMaps.roughness,'linear'),
      emission:map('emission',textures.emission,'sRGB'),
      metallicRoughness:map('metallic-roughness',textures.surface,'linear'),
      coverage:map('coverage',registeredMaps.coverage,'linear')
    };
    const masks=Object.fromEntries(Object.entries(registeredMaps.masks).map(([name,bytes])=>[name,map('mask-'+name,bytes,'linear')]));
    const row={index,name:mesh.name,geometry:projection.geometryHash(mesh.points,faces),
      uvLayout:projection.digest(JSON.stringify([faces,uvs])),texCoord:0,width:size,height:size,padding,
      coverage,emissionStrength:strength,maps,masks,paintViews:plan?.report()??[]};
    meshes.push(row);
    const authored=projection.cameraCapture(mesh,faces,capture.filter(v=>v.mesh===index),kit);
    for(const {id,guide,blank,...view} of authored) {
      output.set('paint-views/'+id+'-guide.png',guide);
      output.set('paint-views/'+id+'-paint.png',blank);
      captures.push({id,...view,paint:id+'-paint.png'});
    }
    return {index,width:size,height:size,uvLayout:row.uvLayout,paintViews:row.paintViews.map(({id,texels})=>({id,texels}))};
  }

  function write(glb) {
    const document={format:'ink-studio/registered-material-bake',version:1,
      glb:path.relative(directory,glb).split(path.sep).join('/'),meshes};
    for(const [file,bytes] of output)files.write(path.join(directory,file),bytes);
    if(captures.length) {
      document.paintManifest='paint-views/approved.json';
      files.json(path.join(directory,document.paintManifest),{
        format:projection.paintFormat,version:1,views:captures
      });
    }
    const file=path.join(directory,'material-bake.json');
    files.json(file,document);
    return file;
  }

  return {validate,record,write,paint:(index,points,faces,kit)=>projection.prepare(points,faces,paint.filter(v=>v.mesh===index),kit)};
}

module.exports = {prepare};
