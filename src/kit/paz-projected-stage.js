/* Painted stage planes, registered ground anchors and planar reflections. */
(function (K) {
  const { V, procedural: P } = K;
  const up = [0,1,0], tau = 2*Math.PI;
  const finite = Number.isFinite;
  const tuple = (value,n) => Array.isArray(value) && value.length===n && Array.from(value).every(finite);
  const fract = v => v-Math.floor(v);
  const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
  const dimension = n => Number.isSafeInteger(n) && n>0 && n<=2048;
  const unit = n => finite(n) && n>=0 && n<=1;
  const texel = (v,n,wrap) => clamp(Math.floor((wrap?fract(v):v)*n),0,n-1);

  function check(condition, explanation) {
    if (!condition) throw new RangeError('Projected stage: ' + explanation);
  }

  function cameraView({ width,height,camera } = {}) {
    const { at,yaw=0,horizon=height/2,fov=Math.PI/3,near=.03,far=256 }=camera??{};
    check(dimension(width) && dimension(height) && width*height<=K.renderOutputs.maxPixels &&
      tuple(at,3) && finite(yaw) && finite(horizon) && finite(fov) && fov>=.03 && fov<Math.PI-.03 &&
      finite(near) && near>=1e-5 && finite(far) && far>near, 'invalid canvas or level camera');
    const origin=at.slice(), focal=height/2/Math.tan(fov/2), centerX=width/2;
    const forward=[Math.sin(yaw),0,Math.cos(yaw)],right=[forward[2],0,-forward[0]];
    const columns=Array.from({length:width},(_,x)=>V.mad(forward,right,(x+.5-centerX)/focal));
    const slopes=Float64Array.from({length:height},(_,y)=>(horizon-y-.5)/focal);
    function project(point) {
      check(tuple(point,3),'project needs a finite XYZ point');
      const delta=V.sub(point,origin), z=V.dot(delta,forward);
      if (z<near || z>far) return null;
      const scale=focal/z;
      const screen=[centerX+V.dot(delta,right)*scale,horizon-delta[1]*scale];
      check(screen.every(finite),'projection exceeds the finite screen range');
      return {x:screen[0],y:screen[1],depth:z,scale};
    }
    function unproject(x,y,altitude) {
      if (!(finite(x) && finite(y) && x>=0 && x<width && y>=0 && y<height)) return null;
      const slope=slopes[Math.floor(y)], depth=(altitude-origin[1])/slope;
      if (!slope || depth<near || depth>far) return null;
      const ray=columns[Math.floor(x)];
      return {x:origin[0]+ray[0]*depth,z:origin[2]+ray[2]*depth,depth};
    }
    return {width,height,focal,near,far,origin,columns,slopes,project,unproject,
      camera:{origin,right,up,forward,center:[centerX,horizon],scale:[focal,focal]}};
  }

  function create({ layers, props=[], scenePalette, paletteRoles } = {}) {
    check(Array.isArray(layers) && layers.length>=1 && layers.length<=24 &&
      Array.isArray(props) && props.length<=256, 'supply 1–24 stage layers and up to 256 props');
    let paintPixels=0;
    const textureCache=new WeakMap(), owners=[null], names=new Set(), grounds=new Map();
    function owner(id,kind) {
      check(typeof id==='string' && id.trim() && !names.has(id), 'stage layers and props need distinct IDs');
      names.add(id);
      return owners.push({id,kind})-1;
    }
    function texture(source) {
      check(source && typeof source==='object','supply an RGBA raster or indexed pixel stamp');
      if (!textureCache.has(source)) {
        const width=source.width??source.w, height=source.height??source.h;
        const data=source.data??source.rgba??source.rgb;
        check(dimension(width) && dimension(height),'invalid paint dimensions');
        const prepared=data===undefined?K.pixelStamps.prepare(source):null;
        paintPixels+=width*height*(prepared?.entries.length??1);
        check(paintPixels<=8*1024*1024,'stage paint exceeds the image budget');
        const frames=prepared?prepared.entries.map(({slots,alpha})=>K.pixelStamps.image({
          width,height,slots,alpha,palette:prepared.palette
        },{scenePalette,paletteRoles}).rgba):[P.raster.rgba({width,height,data,channels:source.channels}).data];
        textureCache.set(source,{ width,height,at:prepared?.at??(()=>0),frames });
      }
      return textureCache.get(source);
    }

    function mirror(value) {
      const { strength=.55, mask, tint=[1,1,1], ripple }=value;
      check(unit(strength) && tuple(tint,3) && tint.every(unit),'reflection needs strength and tint in [0, 1]');
      if (ripple) {
        const {amplitude,frequency=1,speed=1}=ripple;
        check(finite(amplitude) && amplitude>=0 && amplitude<=32 && finite(frequency) && frequency>=0 &&
          finite(speed),'invalid horizontal reflection ripple');
        return {strength,tint:tint.slice(),mask:mask&&texture(mask),ripple:{amplitude,frequency,speed}};
      }
      return {strength,tint:tint.slice(),mask:mask&&texture(mask)};
    }
    const painted=Array.from(layers, ({
      id,type='ground',at,size,paint,repeat,yaw=0,reflect=false,reflection
    }={}) => {
      check(['ground','upright'].includes(type) && tuple(at,3) && tuple(size,2) && size.every(n=>n>0) &&
        (repeat===undefined || tuple(repeat,2)&&repeat.every(n=>n>0)) && finite(yaw) && typeof reflect==='boolean' &&
        (reflection===undefined || reflection===false || type==='ground' && reflection && typeof reflection==='object'),
        'layers need an XYZ origin, positive size, optional repeat and valid reflection settings');
      const across=[Math.cos(yaw),0,-Math.sin(yaw)], along=[-across[2],0,across[0]];
      const frequency=repeat?size.map((n,i)=>n/repeat[i]):[1,1];
      check(frequency.every(n=>finite(n) && n>0 && n<=1e6),'paint repeat exceeds the UV range');
      const row={id:owner(id,type),type,at:at.slice(),size:size.slice(),across,along,frequency,
        wrap:repeat!==undefined,texture:texture(paint),reflect,reflection:reflection?mirror(reflection):null};
      if (type==='ground') grounds.set(id,row);
      return row;
    });
    function ground(id) {
      const layer = id===undefined && grounds.size===1 ? grounds.values().next().value : grounds.get(id);
      check(layer,'select a named ground layer');
      return layer;
    }
    const actors=Array.from(props, ({id,ground:name,at,elevation=0,height,paint,pivot,reflect=true}={}) => {
      check((typeof at==='function' || tuple(at,2)) && (typeof elevation==='function' || finite(elevation)) &&
        finite(height) && height>0 && typeof reflect==='boolean','props need a ground point and a positive height');
      const image=texture(paint), pin=pivot??paint.pivot??[image.width/2,image.height];
      check(tuple(pin,2),'prop pivot needs two art-pixel coordinates');
      return {id:owner(id,'prop'),ground:ground(name),at:typeof at==='function'?at:at.slice(),elevation,
        height,texture:image,pivot:pin.slice(),reflect};
    });

    function groundUV(layer,x,z) {
      const dx=x-layer.at[0],dz=z-layer.at[2];
      return [(dx*layer.across[0]+dz*layer.across[2])/layer.size[0],
        (dx*layer.along[0]+dz*layer.along[2])/layer.size[1]];
    }
    function view(options) {
      const lens=cameraView(options);
      return Object.freeze({ project:lens.project,
        ground(x,y,name) {
          const layer=ground(name), point=lens.unproject(x,y,layer.at[1]);
          if (!point) return null;
          const {x:px,z,depth}=point, uv=groundUV(layer,px,z);
          return uv.every(v=>v>=0 && v<1)?{point:[px,layer.at[1],z],depth,uv}:null;
        }
      });
    }

    function render({width,height,camera,time=0,reflections=true}={}) {
      check(finite(time) && typeof reflections==='boolean','render time and reflection switch are invalid');
      const lens=cameraView({width,height,camera});
      const {origin,near,far,columns,slopes,project}=lens, [eyeX,eyeY,eyeZ]=origin;
      const count=width*height, data=new Uint8Array(count*4), depth=new Float64Array(count).fill(Infinity);
      const ids=new Uint16Array(count), uv=new Float64Array(count*2), placements=[];
      const frames=new Map(), reflected=new Map();
      let work=0;
      function budget(amount) {
        work+=amount;
        check(work<=64*1024*1024,'stage exceeds the pixel work budget');
      }
      function read(image) {
        if (!frames.has(image)) frames.set(image,image.frames[image.at(time)]);
        return frames.get(image);
      }
      function write(x,y,z,u,v,layer,target,art,reflection) {
        const p=y*width+x;
        if (z>target.depth[p]) return;
        const {texture,wrap}=layer;
        const tx=texel(u,texture.width,wrap),ty=texel(v,texture.height,wrap);
        const src=(ty*texture.width+tx)*4,dst=p*4;
        if (art[src+3]<128) return;
        for (let c=0;c<3;c++) target.data[dst+c]=reflection?
          Math.round(art[src+c]*(1-reflection.weight)+reflection.rgb[c]*reflection.weight):art[src+c];
        target.data[dst+3]=255;
        target.depth[p]=z;
        if (target===scene) { ids[p]=layer.id; uv[p*2]=u; uv[p*2+1]=v; }
      }
      const scene={data,depth};
      const poses=actors.map(actor=>{
        const at=typeof actor.at==='function'?actor.at(time):actor.at;
        const elevation=typeof actor.elevation==='function'?actor.elevation(time):actor.elevation;
        check(tuple(at,2) && finite(elevation),'prop animation must return a finite ground point and elevation');
        return {actor,point:[at[0],actor.ground.at[1]+elevation,at[1]]};
      });

      function upright(layer,target,mirrorY) {
        budget(count);
        const [lx,ly,lz]=layer.at, [w,h]=layer.size;
        const normal=layer.along,tangent=layer.across;
        const separation=(lx-eyeX)*normal[0]+(lz-eyeZ)*normal[2];
        const pixels=read(layer.texture), [ru,rv]=layer.frequency;
        for (let x=0;x<width;x++) {
          const ray=columns[x], cosine=V.dot(ray,normal);
          if (Math.abs(cosine)<1e-10) continue;
          const z=separation/cosine;
          if (z<near || z>far) continue;
          const u=((eyeX+ray[0]*z-lx)*tangent[0]+(eyeZ+ray[2]*z-lz)*tangent[2])/w;
          if (u<0 || u>=1) continue;
          for (let y=0;y<height;y++) {
            const sampleY=eyeY+slopes[y]*z, originalY=mirrorY===undefined?sampleY:2*mirrorY-sampleY;
            const v=1-(originalY-ly)/h;
            if (v<0 || v>=1 || (mirrorY!==undefined && originalY<mirrorY)) continue;
            write(x,y,z,u*ru,v*rv,layer,target,pixels);
          }
        }
      }

      function sprite(pose,target,mirrorY) {
        const {actor,point}=pose, {texture,pivot}=actor, anchor=project(point);
        if (!anchor) return;
        const span=actor.height*anchor.scale;
        if (span<.5) return;
        const h=Math.max(1,Math.round(span)),w=Math.max(1,Math.round(span*texture.width/texture.height));
        const left=Math.round(anchor.x-pivot[0]*w/texture.width),top=Math.round(anchor.y-pivot[1]*h/texture.height);
        check([w,h,left,top].every(finite),'prop exceeds the finite screen range');
        // Mirror the snapped art rectangle so the reflected and visible pivots stay registered.
        const reflectAt=mirrorY===undefined?null:project([point[0],mirrorY,point[2]]);
        const rowAxis=reflectAt?2*Math.round(reflectAt.y):null;
        const yStart=rowAxis===null?top:rowAxis-top-h;
        const x0=Math.max(0,left),x1=Math.min(width,left+w),y0=Math.max(0,yStart),y1=Math.min(height,yStart+h);
        if (x0>=x1 || y0>=y1) return;
        budget((x1-x0)*(y1-y0));
        const art=read(texture);
        for (let y=y0;y<y1;y++) {
          const v=rowAxis===null?(y+.5-top)/h:(rowAxis-y-.5-top)/h;
          if (mirrorY!==undefined && eyeY+slopes[y]*anchor.depth>=mirrorY) continue;
          for (let x=x0;x<x1;x++) write(x,y,anchor.depth,(x+.5-left)/w,v,actor,target,art);
        }
        if (target===scene) placements.push({id:owners[actor.id].id,anchor:[anchor.x,anchor.y],rect:[left,top,w,h]});
      }

      function reflectPlane(y) {
        if (!reflected.has(y)) {
          check(reflected.size<4,'a frame can retain reflections at up to four elevations');
          const target={data:new Uint8Array(count*4),depth:new Float64Array(count).fill(Infinity)};
          for (const layer of painted) if (layer.type==='upright' && layer.reflect) upright(layer,target,y);
          for (const pose of poses) if (pose.actor.reflect) sprite(pose,target,y);
          reflected.set(y,target);
        }
        return reflected.get(y);
      }
      function floor(layer) {
        budget(count);
        const altitude=layer.at[1], settings=reflections && eyeY>altitude?layer.reflection:null;
        const reflectedView=settings?.strength?reflectPlane(altitude):null;
        const mask=settings?.mask, matte=mask&&read(mask), ripple=settings?.ripple;
        const pixels=read(layer.texture), [ru,rv]=layer.frequency;
        for (let y=0;y<height;y++) {
          const z=(altitude-eyeY)/slopes[y];
          if (!slopes[y] || z<near || z>far) continue;
          for (let x=0;x<width;x++) {
            const p=y*width+x;
            if (z>depth[p]) continue;
            const ray=columns[x], wx=eyeX+ray[0]*z,wz=eyeZ+ray[2]*z;
            const [u,v]=groundUV(layer,wx,wz);
            if (u<0 || u>=1 || v<0 || v>=1) continue;
            let reflection;
            if (reflectedView) {
              const wet=matte?matte[(texel(v,mask.height,false)*mask.width+texel(u,mask.width,false))*4+3]/255:1;
              const shift=ripple?Math.round(ripple.amplitude*Math.sin(tau*(wz*ripple.frequency-time*ripple.speed))):0;
              const from=x+shift, sample=y*width+from;
              if (wet && from>=0 && from<width && reflectedView.data[sample*4+3] && reflectedView.depth[sample]>z) {
                reflection={weight:wet*settings.strength,rgb:settings.tint.map((gain,c)=>gain*reflectedView.data[sample*4+c])};
              }
            }
            write(x,y,z,u*ru,v*rv,layer,scene,pixels,reflection);
          }
        }
      }
      for (const layer of painted) {
        if (layer.type==='ground') floor(layer);
        else upright(layer,scene);
      }
      for (const pose of poses) sprite(pose,scene);
      return K.renderOutputs.create({width,height,data,depth,ids,uv,owners,camera:lens.camera,placements});
    }
    return Object.freeze({view,render});
  }

  K.projectedStage = Object.freeze({create});
})(KIT);
