/* Sample editable vectors explicitly for Ink path and image ports. */
(function (P) {
  const V=VectorResources, Pth=VectorPaths;
  const maxExtent=4096, maxPixels=2**20;
  function length(attrs,name,fallback=0) {
    const value=attrs[name];
    if (value===undefined) return fallback;
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:px)?$/i.test(value.trim()))
      throw new TypeError('Vector graph geometry needs user units or px for SVG '+name);
    return Number(value.trim().replace(/px$/i,''));
  }

  function shape(node) {
    const {tag,attrs}=node, zero=n=>length(attrs,n);
    if (tag==='path') return node.segments;
    if (tag==='line') return [['M',zero('x1'),zero('y1')],['L',zero('x2'),zero('y2')]];
    if (tag==='polyline'||tag==='polygon') {
      const coords=Pth.numbers(attrs.points??''), segments=[];
      for(let i=0;i<coords.length;i+=2) segments.push([i?'L':'M',coords[i],coords[i+1]]);
      if (segments.length&&tag==='polygon') segments.push(['Z']);
      return segments;
    }
    if (tag==='circle'||tag==='ellipse') {
      const [x,y]=[zero('cx'),zero('cy')], a=zero(tag==='circle'?'r':'rx'), b=tag==='circle'?a:zero('ry');
      return a>0&&b>0 ? [['M',x+a,y],['A',a,b,0,1,0,x-a,y],['A',a,b,0,1,0,x+a,y],['Z']] : [];
    }
    if (tag==='rect') {
      const x=zero('x'),y=zero('y'),w=zero('width'),h=zero('height');
      if (!(w>0&&h>0)) return [];
      const a=Math.min(w/2,length(attrs,'rx',zero('ry'))), b=Math.min(h/2,length(attrs,'ry',zero('rx')));
      if (!a||!b) return [['M',x,y],['L',x+w,y],['L',x+w,y+h],['L',x,y+h],['Z']];
      return [['M',x+a,y],['L',x+w-a,y],['A',a,b,0,0,1,x+w,y+b],
        ['L',x+w,y+h-b],['A',a,b,0,0,1,x+w-a,y+h],
        ['L',x+a,y+h],['A',a,b,0,0,1,x,y+h-b],['L',x,y+b],['A',a,b,0,0,1,x+a,y],['Z']];
    }
    throw new TypeError('Select an SVG path or basic shape for vector sampling');
  }

  function selected(source,key,screen) {
    const {nodes}=V.index(source), lookup=nodes.get(key);
    if (!lookup) throw new RangeError('Unknown vector element '+key);
    const {node}=lookup;
    const hierarchy=[node];
    for (let row=lookup;row.parent;row=nodes.get(row.parent.key)) hierarchy.unshift(row.parent);
    if (hierarchy.slice(0,-1).some(n=>V.definitions.includes(n.tag)))
      throw new TypeError('Vector sampling requires a visible SVG shape outside definitions');
    const root=hierarchy[0].attrs, box=V.viewBox(root.viewBox), rootTransform=V.matrix(root.transform);
    const windowTransform=screen ? V.viewport(box,...screen,root.preserveAspectRatio) : V.identity;
    let elementTransform=V.identity, rule='nonzero';
    for(let i=0;i<hierarchy.length;i++) {
      const element=hierarchy[i], a=element.attrs, css=V.style(a.style);
      const resolved=css['fill-rule']??a['fill-rule'];
      if (resolved==='evenodd'||resolved==='nonzero') rule=resolved;
      else if (resolved==='initial'||resolved==='revert') rule='nonzero';
      if (!i) continue;
      elementTransform=V.multiply(elementTransform,V.matrix(a.transform));
      if (element.tag==='svg') {
        const box=V.viewBox(a.viewBox);
        const width=length(a,'width',box?.[2]), height=length(a,'height',box?.[3]);
        if (box && !(width>0&&height>0)) throw new RangeError('Nested SVG viewBox needs positive viewport dimensions');
        const offset=[1,0,0,1,length(a,'x'),length(a,'y')];
        elementTransform=V.multiply(elementTransform,V.multiply(offset,V.viewport(box,width,height,a.preserveAspectRatio)));
      }
    }
    return {node,rule,elementTransform,curves:shape(node),
      transform:V.multiply(rootTransform,V.multiply(windowTransform,elementTransform))};
  }

  function extract(source,key,{index=0,tolerance=.125,maxPoints=2048,space='document'}={}) {
    if (!['document','local'].includes(space)||!Number.isSafeInteger(index)||index<0)
      throw new RangeError('Vector contour needs an index and local or document coordinates');
    const context=selected(source,key);
    const points=Pth.flatten(context.curves,space==='document' ? p=>V.point(context.transform,p) : undefined,{tolerance,maxPoints})
      .filter(row=>row.points.length>=2);
    if (!points[index]) throw new RangeError('No nonempty vector contour at index '+index);
    return {value:points[index], contours:points,
      info:{key,rule:context.rule,space,transform:context.transform,elementTransform:context.elementTransform}};
  }

  function fillMask(source,key,{width=128,height=128,samples=1,tolerance=.125,rule}={}) {
    if (![width,height].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=maxExtent)||width*height>maxPixels||
        ![1,2,4].includes(samples)||rule!==undefined&&!['evenodd','nonzero'].includes(rule))
      throw new RangeError('Invalid vector fill extent, samples or winding rule');
    const context=selected(source,key,[width,height]), winding=rule??context.rule;
    const contours=Pth.flatten(context.curves,p=>V.point(context.transform,p),{tolerance});
    const rows=height*samples, columns=width*samples, starts=Array.from({length:rows},()=>[]);
    const boundary=(n,max)=>Math.max(0,Math.min(max,Math.ceil(n*samples-.5)));
    for (const {points} of contours) for(let i=0;i<points.length;i++) {
      const p=points[i], q=points[(i+1)%points.length];
      if (p[1]===q[1]) continue;
      const direction=p[1]<q[1]?1:-1, [a,b]=direction===1?[p,q]:[q,p];
      const begin=boundary(a[1],rows), end=boundary(b[1],rows);
      if (begin<end) starts[begin].push({x:a[0],y:a[1],dx:b[0]-a[0],dy:b[1]-a[1],end,direction});
    }
    const data=new Float32Array(width*height), scale=1/(samples*samples);
    let active=[], work=0;
    for(let y=0;y<rows;y++) {
      active=active.filter(edge=>edge.end>y);
      active.push(...starts[y]);
      if (!active.length) continue;
      work+=active.length*(1+Math.ceil(Math.log2(active.length)));
      if (work>24e6) throw new RangeError('Vector fill exceeds its scanline budget');
      const scan=(y+.5)/samples, offset=Math.floor(y/samples)*width;
      const crossings=active.map(({x,direction,dx,dy,y:base})=>[x+(scan-base)/dy*dx,direction]).sort((a,b)=>a[0]-b[0]);
      let count=0;
      for(let i=0;i<crossings.length-1;i++) {
        count+=crossings[i][1];
        if (winding==='evenodd'?!(count%2):!count) continue;
        const lo=boundary(crossings[i][0],columns),hi=boundary(crossings[i+1][0],columns);
        for(let x=lo;x<hi;x++) data[offset+Math.floor(x/samples)]+=scale;
      }
    }
    return {value:P.graphImages.declare({width,height,data,channels:1},{intent:'mask',precision:'float32'}),
      info:{key,rule:winding,samples,contours:contours.length,viewBox:V.viewBox(source.root.attrs.viewBox)}};
  }

  const doc='vectorDocument', source={source:doc}, options={type:'record',default:{}};
  const operations=Object.freeze({
    'vector.import': {
      description:'Read passive SVG into its editable hierarchy of curves, basic shapes and presentation.',
      inputs:{svg:'string'},outputs:{value:doc},run:({svg})=>({value:V.parse(svg)})
    },
    'vector.edit': {
      description:'Apply ordered edits to retained SVG points, segments, attributes and hierarchy.',
      inputs:{...source,edits:'array<record>'},outputs:{value:doc},run:({source,edits})=>({value:V.edit(source,edits)})
    },
    'vector.export': {
      description:'Write editable vector geometry and presentation as SVG text.',
      inputs:source,outputs:{value:'string'},run:({source})=>({value:V.write(source)})
    },
    'vector.path': {
      description:'Sample a selected vector shape into existing Ink paths with an explicit curve tolerance.',
      inputs:{...source,key:'string',options},outputs:{value:'path',contours:'array<path>',info:'record'},
      run:({source,key,options})=>extract(source,key,options)
    },
    'vector.fillMask': {
      description:'Rasterize one vector shape as a typed fill mask using its winding rule and the SVG viewBox.',
      inputs:{...source,key:'string',options},outputs:{value:'grayImage',info:'record'},
      run:({source,key,options})=>fillMask(source,key,options)
    }
  });
  P.vectorResources=Object.freeze({importSVG:V.parse,exportSVG:V.write,edit:V.edit,describe:V.describe,
    handles:Pth.handles,path:extract,fillMask,operations});
})(KIT.procedural);
