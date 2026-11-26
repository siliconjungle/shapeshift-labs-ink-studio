/* Portable, passive SVG resources. Geometry and presentation survive editing and export. */
const VectorResources = (() => {
  const path = typeof VectorPaths === 'undefined' ? require('./vector-paths.js') : VectorPaths;
  const format='ink-studio/vector', version=1, ns='http://www.w3.org/2000/svg', xlink='http://www.w3.org/1999/xlink';
  const maxText=2*1024**2, maxNodes=4096, maxDepth=48;
  const record = x => x && [Object.prototype,null].includes(Object.getPrototypeOf(x));
  const fields = (x,keys) => record(x) && Object.keys(x).every(k=>keys.includes(k));
  const key = s=>typeof s==='string' && /^[A-Za-z_][\w.:-]{0,127}$/.test(s) &&
    !['constructor','prototype','__proto__'].includes(s);
  const shapeNames = ['path','rect','circle','ellipse','line','polyline','polygon'];
  const paintKeys = ['fill','fill-rule','fill-opacity','stroke','stroke-width','stroke-opacity','stroke-linecap',
    'stroke-linejoin','stroke-miterlimit','stroke-dasharray','stroke-dashoffset','color','opacity','display','visibility',
    'vector-effect','paint-order','shape-rendering','clip-path','clip-rule','stop-color','stop-opacity','color-interpolation',
    'overflow'];
  const common = ['id','class','style','transform','role','aria-label','aria-labelledby','aria-describedby',...paintKeys];
  const geometry = {
    svg:['viewBox','width','height','x','y','preserveAspectRatio','version'], g:[], defs:[],
    clipPath:['clipPathUnits'], use:['href','x','y','width','height'],
    linearGradient:['href','x1','y1','x2','y2','gradientUnits','gradientTransform','spreadMethod'],
    radialGradient:['href','cx','cy','r','fx','fy','fr','gradientUnits','gradientTransform','spreadMethod'],
    stop:['offset'], path:['pathLength'], rect:['x','y','width','height','rx','ry','pathLength'],
    circle:['cx','cy','r','pathLength'], ellipse:['cx','cy','rx','ry','pathLength'],
    line:['x1','y1','x2','y2','pathLength'], polyline:['points','pathLength'], polygon:['points','pathLength'],
    title:[], desc:[]
  };
  const textTags=['title','desc'];
  const definitions=['linearGradient','radialGradient','clipPath','defs','stop'];
  const pointer = /url\(\s*(["']?)#([A-Za-z_][\w.:-]{0,127})\1\s*\)/ig;
  const numeric = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?';
  const lengthPattern = new RegExp('^('+numeric+')(?:%|px|pt|pc|cm|mm|in|em|ex|rem|q)?$','i');
  const lengthKeys = new Set(['x','y','width','height','rx','ry','cx','cy','r','x1','x2','y1','y2','fx','fy','fr',
    'stroke-width','stroke-dashoffset','offset']);
  const nonnegative=new Set(['width','height','rx','ry','r','fr','stroke-width']);
  const identity=Object.freeze([1,0,0,1,0,0]);
  function multiply([a,b,c,d,e,f],[g,h,i,j,k,l]) {
    return [a*g+c*h,b*g+d*h,a*i+c*j,b*i+d*j,a*k+c*l+e,b*k+d*l+f];
  }
  function point([a,b,c,d,e,f],[x,y]) { return [a*x+c*y+e,b*x+d*y+f]; }

  function matrix(text = '') {
    if (typeof text!=='string' || text.length>8192) throw new TypeError('SVG transform needs a bounded transform list');
    if (text.trim()==='none') return identity.slice();
    const commands=/([a-zA-Z]+)\s*\(([^()]*)\)/g;
    let at=0,result=identity,count=0;
    for (const match of text.matchAll(commands)) {
      const gap=text.slice(at,match.index);
      if (!(at ? /^[\s]*(?:,[\s]*)?$/ : /^\s*$/).test(gap) || ++count>96)
        throw new SyntaxError('Invalid SVG transform separator or count');
      at=match.index+match[0].length;
      const [,kind,list]=match,n=path.numbers(list),[x,y]=n;
      let next;
      if (kind==='matrix' && n.length===6) next=n;
      else if (kind==='translate' && [1,2].includes(n.length)) next=[1,0,0,1,x,y??0];
      else if (kind==='scale' && [1,2].includes(n.length)) next=[x,0,0,y??x,0,0];
      else if (kind==='rotate' && [1,3].includes(n.length)) {
        const a=(x%360)*Math.PI/180, [c,s]=[Math.cos(a),Math.sin(a)], [u,v]=n.slice(1);
        next=n.length===1 ? [c,s,-s,c,0,0] : [c,s,-s,c,u-c*u+s*v,v-s*u-c*v];
      } else if (['skewX','skewY'].includes(kind) && n.length===1 && Math.abs(x%180)!==90) {
        const skew=Math.tan((x%180)*Math.PI/180);
        next=kind==='skewX' ? [1,0,skew,1,0,0] : [1,skew,0,1,0,0];
      } else throw new SyntaxError('Invalid SVG transform ' + kind);
      result=multiply(result,next);
      if (result.some(v=>!Number.isFinite(v)||Math.abs(v)>1e12)) throw new RangeError('SVG transform exceeds its coordinate range');
    }
    if (!/^\s*$/.test(text.slice(at))) throw new SyntaxError('Invalid SVG transform list');
    return result.slice();
  }

  function viewBox(value) {
    if (value===undefined) return null;
    const box=Array.isArray(value) ? value : path.numbers(value);
    if (box.length!==4 || !Array.from(box).every(n=>Number.isFinite(n)&&Math.abs(n)<=1e9) || box[2]<=0 || box[3]<=0)
      throw new RangeError('SVG viewBox needs four finite values and positive width and height');
    return box.slice();
  }
  function preserve(value = 'xMidYMid meet') {
    const match=/^(none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max))(?:\s+(meet|slice))?$/.exec(value.trim());
    if (!match) throw new TypeError('Invalid SVG preserveAspectRatio');
    return [match[1],match[2]??'meet'];
  }
  function viewport(box,w,h,aspect) {
    if (!box) return identity.slice();
    const [x,y,bw,bh]=box, [align,mode]=preserve(aspect);
    let sx=w/bw,sy=h/bh, ex=0,ey=0;
    if (align!=='none') {
      sx=sy=mode==='slice'?Math.max(sx,sy):Math.min(sx,sy);
      const ratio=value=>value==='Min'?0:value==='Mid'?.5:1;
      ex=(w-bw*sx)*ratio(align.slice(1,4));ey=(h-bh*sy)*ratio(align.slice(5));
    }
    return [sx,0,0,sy,ex-x*sx,ey-y*sy];
  }

  function xmlChar(n) {
    return n===9||n===10||n===13||n>=32&&n<=0xd7ff||n>=0xe000&&n<=0xfffd||n>=0x10000&&n<=0x10ffff;
  }
  function decode(xml) {
    const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
    return xml.replace(/&(?:([^&;\s]{1,32});)?/g,(_,body)=>{
      if (Object.hasOwn(entities,body)) return entities[body];
      const numeric=/^#(?:x([0-9a-f]+)|(\d+))$/i.exec(body??'');
      const n=numeric && parseInt(numeric[1]??numeric[2],numeric[1]?16:10);
      if (!numeric || !xmlChar(n)) throw new SyntaxError('Invalid XML entity ' + (body??''));
      return String.fromCodePoint(n);
    });
  }
  function escaped(value) {
    const entities={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;','\n':'&#10;','\r':'&#13;','\t':'&#9;'};
    return value.replace(/[&<>"'\n\r\t]/g,c=>entities[c]);
  }
  function valueChars(value) {
    if (typeof value!=='string' || value.length>maxText) return false;
    for (const c of value) if (!xmlChar(c.codePointAt(0))) return false;
    return true;
  }
  function paint(prop,value) {
    const css=value.trim(), rest=css.replace(pointer,'');
    if (/(?:url|image|expression|var|attr)\s*\(/i.test(rest) ||
        /url\s*\(/i.test(css) && !['fill','stroke','clip-path'].includes(prop))
      throw new TypeError('SVG paint references must be local fragments');
    if (!css || !/^[\w\s#.,%()+\-/]*$/.test(rest))
      throw new TypeError('Invalid inline SVG presentation value for ' + prop);
    if (['fill-rule','clip-rule'].includes(prop) && !['nonzero','evenodd','inherit','initial','unset','revert'].includes(css))
      throw new TypeError('SVG winding rule must be nonzero or evenodd');
    if (lengthKeys.has(prop) && !['inherit','initial','unset','revert'].includes(css)) {
      const n=lengthPattern.exec(css);
      if (!n || !Number.isFinite(Number(n[1])) || Math.abs(Number(n[1]))>1e9 || nonnegative.has(prop)&&Number(n[1])<0)
        throw new RangeError('Invalid SVG length ' + prop);
    }
    return css;
  }
  function style(text='') {
    const props=Object.create(null);
    for (const entry of text.split(';').filter(row=>row.trim())) {
      const at=entry.indexOf(':'), prop=entry.slice(0,at).trim();
      if (at<0 || !paintKeys.includes(prop)) throw new TypeError('Unsupported inline SVG property ' + prop);
      props[prop]=paint(prop,entry.slice(at+1));
    }
    return props;
  }

  function attributes(tag,input) {
    if (!record(input) || Object.keys(input).length>80) throw new TypeError('SVG element needs a bounded attribute record');
    for (const [name, value] of Object.entries(input)) {
      if (!valueChars(value) || (!common.includes(name) && !geometry[tag].includes(name) &&
          !/^data-[a-z][\w.-]{0,75}$/.test(name)) || name==='data-ink-key')
        throw new TypeError('Unsupported SVG attribute ' + name + ' on ' + tag);
      if (name==='id' && !key(value)) throw new TypeError('SVG ID needs a local identifier');
      if (name==='href' && (!value.startsWith('#') || !key(value.slice(1))))
        throw new TypeError('SVG href must be a local fragment');
      if (paintKeys.includes(name)) paint(name,value);
      else if (name==='style') style(value);
      else if (['transform','gradientTransform'].includes(name)) matrix(value);
      else if (name==='viewBox') viewBox(value);
      else if (name==='preserveAspectRatio') preserve(value);
      else if (name==='points' && path.numbers(value).length%2) throw new TypeError('SVG points need paired coordinates');
      else if (name==='pathLength' && (!lengthPattern.test(value) || !Number.isFinite(Number(value)) || Number(value)<0))
        throw new TypeError('SVG pathLength needs a nonnegative number');
      else if (lengthKeys.has(name)) paint(name,value);
      else if (['gradientUnits','clipPathUnits'].includes(name) && !['userSpaceOnUse','objectBoundingBox'].includes(value))
        throw new TypeError('Invalid SVG unit system');
      else if (name==='spreadMethod' && !['pad','reflect','repeat'].includes(value)) throw new TypeError('Invalid SVG gradient spread');
    }
    return input;
  }
  function childOf(parent,tag) {
    if (!parent) return tag==='svg';
    if (textTags.includes(tag)) return !textTags.includes(parent);
    if (['linearGradient','radialGradient'].includes(parent)) return tag==='stop';
    if (parent==='clipPath') return shapeNames.includes(tag)||['g','use'].includes(tag);
    if (['svg','g','defs'].includes(parent)) return tag!=='stop';
    return false;
  }

  function parse(xml) {
    if (typeof xml!=='string' || !xml.length || !valueChars(xml) || new TextEncoder().encode(xml).length>maxText)
      throw new RangeError('SVG text exceeds its size or character budget');
    xml=xml.replace(/\r\n?/g,'\n');
    const elements=[], stack=[], count={ n:0 };
    let root, at=xml.charCodeAt(0)===0xfeff ? 1 : 0, prefixed=false, declaration=false;
    function body(text) {
      if (!text.trim() && !textTags.includes(stack.at(-1)?.tag)) return;
      const node=stack.at(-1);
      if (!node || !textTags.includes(node.tag)) throw new SyntaxError('Unexpected SVG text outside title or desc');
      node.text+=text;
    }
    const start=/<(svg:)?([A-Za-z][\w-]*)/y, close=/<\/(svg:)?([A-Za-z][\w-]*)[\t\r\n ]*>/y;
    const attr=/[\t\r\n ]+([A-Za-z_][\w.:-]*)[\t\r\n ]*=[\t\r\n ]*(?:"([^"<]*)"|'([^'<]*)')/y;
    while (at<xml.length) {
      if (xml[at]!=='<') {
        const next=xml.indexOf('<',at);
        body(decode(xml.slice(at,next<0?xml.length:next)));
        at=next<0?xml.length:next;continue;
      }
      if (xml.startsWith('<!--',at)) {
        const end=xml.indexOf('-->',at+4);
        if (end<0 || xml.slice(at+4,end).includes('--')) throw new SyntaxError('Invalid SVG XML comment');
        at=end+3;continue;
      }
      if (xml.startsWith('<![CDATA[',at)) {
        const end=xml.indexOf(']]>',at+9);
        if (end<0 || !textTags.includes(stack.at(-1)?.tag)) throw new SyntaxError('CDATA is only allowed in SVG title and desc');
        body(xml.slice(at+9,end)); at=end+3;continue;
      }
      if (xml.startsWith('<?xml',at)) {
        const end=xml.indexOf('?>',at+5), header=xml.slice(at,end+2);
        if (end<0 || root || declaration || !/^<\?xml\s+version\s*=\s*(['"])1\.0\1(?:\s+encoding\s*=\s*(['"])utf-8\2)?(?:\s+standalone\s*=\s*(['"])(?:yes|no)\3)?\s*\?>$/i.test(header))
          throw new SyntaxError('Expected an SVG XML 1.0 UTF-8 declaration');
        declaration=true;at=end+2;continue;
      }
      close.lastIndex=at;
      const ending=close.exec(xml);
      if (ending) {
        const node=stack.pop();
        if (!node || node.tag!==ending[2] || node.prefix!==ending[1]) throw new SyntaxError('Mismatched SVG closing element');
        at=close.lastIndex;continue;
      }
      start.lastIndex=at;
      const opening=start.exec(xml);
      if (!opening) throw new SyntaxError('Unsupported SVG XML declaration or markup');
      const [,prefix,tag]=opening;
      if (!Object.hasOwn(geometry,tag)||!childOf(stack.at(-1)?.tag,tag)||(!stack.length&&root))
        throw new TypeError('Unsupported SVG element ' + tag + ' in this location');
      if (stack.length>=maxDepth || ++count.n>maxNodes) throw new RangeError('SVG exceeds its hierarchy budget');
      const raw=Object.create(null);
      at=start.lastIndex;
      while (true) {
        attr.lastIndex=at;
        const m=attr.exec(xml);
        if (!m) break;
        if (Object.hasOwn(raw,m[1]) || Object.keys(raw).length>=80) throw new SyntaxError('Duplicate or excess SVG attributes');
        raw[m[1]]=decode((m[2]??m[3]).replace(/[\t\n]/g,' '));at=attr.lastIndex;
      }
      while (/[\t\r\n ]/.test(xml[at]??'')) at++;
      const leaf=xml.startsWith('/>',at);
      if (!leaf && xml[at]!=='>') throw new SyntaxError('Expected a quoted SVG attribute or element end');
      at+=leaf?2:1;
      for (const [name, expected] of [['xmlns',ns],['xmlns:svg',ns],['xmlns:xlink',xlink]]) {
        if (raw[name]!==undefined && raw[name]!==expected) throw new TypeError('Unexpected SVG namespace ' + name);
      }
      if (!root && raw['xmlns:svg']===ns) prefixed=true;
      if (prefix && !prefixed) throw new SyntaxError('The SVG prefix needs its namespace on the root');
      const {xmlns,'xmlns:svg': _ns,'xmlns:xlink': _xlink,'xlink:href': linked,'data-ink-key': saved,d,...attrs}=raw;
      if (linked!==undefined) {
        if (attrs.href!==undefined && attrs.href!==linked) throw new TypeError('SVG href aliases disagree');
        attrs.href=linked;
      }
      if (d!==undefined && tag!=='path') throw new TypeError('Path data requires an SVG path element');
      const node={ key:saved??attrs.id,tag,attrs,
        ...(tag==='path' && {segments:path.parse(d??'')}),
        ...(textTags.includes(tag) ? {text:''} : {children:[]}) };
      elements.push(node);
      if (!root) root=node;
      else stack.at(-1).children.push(node);
      if (!leaf) stack.push({ ...node, prefix, get text(){return node.text;}, set text(value){node.text=value;} });
    }
    if (!root || stack.length) throw new SyntaxError('SVG document needs one closed root element');
    const named=new Set(elements.map(node=>node.key).filter(n=>n!==undefined));
    let next=0;
    for (const node of elements) if (node.key===undefined) {
      do {node.key='_ink'+(++next);} while (named.has(node.key));
      named.add(node.key);
    }
    const document={format,version,root};
    index(document);
    return document;
  }

  function index(document) {
    if (!fields(document,['format','version','root']) || document.format!==format || document.version!==version)
      throw new TypeError('Expected version 1 Ink vector document');
    const nodes=new Map(), ids=new Map(), links=new Map(), active=new Set(), resolved=new Map();
    let segments=0,chars=0;
    function visit(node,parent,depth) {
      if (depth>=maxDepth || nodes.size>=maxNodes) throw new RangeError('SVG exceeds its hierarchy budget');
      if (!fields(node,['key','tag','attrs','segments','children','text']) || !key(node.key) || nodes.has(node.key) ||
          typeof node.tag!=='string' || !Object.hasOwn(geometry,node.tag) || !childOf(parent?.tag,node.tag))
        throw new TypeError('Invalid or duplicate SVG element key ' + node?.key);
      const {attrs,tag}=node;
      attributes(tag,attrs);
      if (tag==='path') segments+=path.validate(node.segments).length;
      else if (node.segments!==undefined) throw new TypeError('Only path elements have segments');
      if (segments>path.maxSegments) throw new RangeError('SVG exceeds its total segment budget');
      chars+=Object.values(attrs).reduce((sum,value)=>sum+value.length,0)+(node.text?.length??0);
      if (chars>maxText) throw new RangeError('SVG exceeds its attribute or text budget');
      if (attrs.id) {
        if (ids.has(attrs.id)) throw new TypeError('Duplicate SVG ID ' + attrs.id);
        ids.set(attrs.id,node);
      }
      nodes.set(node.key,{node,parent});
      const refs=[];
      if (attrs.href) refs.push(attrs.href.slice(1));
      for (const attribute of ['fill','stroke','clip-path','style']) if (attrs[attribute]) {
        for (const ref of attrs[attribute].matchAll(pointer)) refs.push(ref[2]);
      }
      links.set(node.key,refs);
      if (textTags.includes(tag)) {
        if (!valueChars(node.text) || node.children!==undefined) throw new TypeError('Invalid SVG title or desc');
      } else {
        if (node.text!==undefined || !Array.isArray(node.children) || node.children.length>maxNodes)
          throw new TypeError('SVG elements need an ordered children list');
        for (const child of node.children) visit(child,node,depth+1);
      }
    }
    visit(document.root,null,0);
    function resolve(node,depth) {
      if (depth>256) throw new RangeError('SVG exceeds its reference depth');
      if (active.has(node.key)) throw new RangeError('Circular SVG reference at ' + node.key);
      if (resolved.has(node.key)) return resolved.get(node.key);
      active.add(node.key);
      let work=1+(node.segments?.length??0), height=0;
      function include(next) {
        const child=resolve(next,depth+1);
        work+=child.work;
        height=Math.max(height,1+child.height);
        if (height>256 || work>262144) throw new RangeError('SVG exceeds its reference expansion budget');
      }
      for (const ref of links.get(node.key)) {
        const target=ids.get(ref);
        if (!target) throw new RangeError('Unresolved SVG fragment #' + ref);
        include(target);
      }
      for (const child of node.children??[]) include(child);
      const result={work,height};
      active.delete(node.key);
      resolved.set(node.key,result);
      return result;
    }
    resolve(document.root,0);
    return {nodes,ids};
  }

  function valid(value) {
    try {index(value);return true;} catch {return false;}
  }
  function write(document) {
    index(document);
    function serialize(node,depth) {
      const attrs={...node.attrs};
      if (!depth) attrs.xmlns=ns;
      if (node.key!==attrs.id) attrs['data-ink-key']=node.key;
      if (node.tag==='path') attrs.d=path.encode(node.segments);
      const inside=Object.entries(attrs).map(([name,value])=>' '+name+'="'+escaped(value)+'"').join('');
      const first='  '.repeat(depth)+'<'+node.tag+inside;
      if (node.text!==undefined) return first+'>'+escaped(node.text)+'</'+node.tag+'>';
      if (!node.children.length) return first+'/>';
      return first+'>\n'+node.children.map(child=>serialize(child,depth+1)).join('\n')+'\n'+'  '.repeat(depth)+'</'+node.tag+'>';
    }
    const svg=serialize(document.root,0)+'\n';
    if (svg.length>maxText || new TextEncoder().encode(svg).length>maxText)
      throw new RangeError('SVG export exceeds its text budget');
    return svg;
  }
  function edit(source, requests) {
    if (!Array.isArray(requests) || requests.length>256) throw new TypeError('Vector edits accept up to 256 steps');
    if (!requests.length) { index(source); return source; }
    const document=structuredClone(source);
    let table=index(document).nodes;
    for (const request of requests) {
      const node=table.get(request?.key)?.node;
      if (!node) throw new RangeError('Unknown SVG element ' + request?.key);
      if (request.kind==='point' && fields(request,['kind','key','segment','handle','at','tangent','translateHandles']) && node.tag==='path') {
        node.segments=path.editPoint(node.segments,request.segment,request.handle,request.at,request);
      } else if (request.kind==='path' && fields(request,['kind','key','d']) && node.tag==='path') {
        node.segments=path.parse(request.d);
      } else if (request.kind==='segment' && fields(request,['kind','key','segment','value']) && node.tag==='path') {
        if (!Number.isSafeInteger(request.segment) || !node.segments[request.segment]) throw new RangeError('Unknown SVG segment');
        node.segments[request.segment]=structuredClone(request.value);
        path.validate(node.segments);
      } else if (request.kind==='attributes' && fields(request,['kind','key','attrs']) && record(request.attrs)) {
        for (const [name,value] of Object.entries(request.attrs)) {
          if (value===null) delete node.attrs[name];
          else if (name==='viewBox' && Array.isArray(value)) node.attrs[name]=viewBox(value).join(' ');
          else Object.defineProperty(node.attrs,name,{value,enumerable:true,writable:true,configurable:true});
        }
        attributes(node.tag,node.attrs);
      } else if (request.kind==='move' && fields(request,['kind','key','parent','index'])) {
        const before=table.get(node.key).parent, target=table.get(request.parent)?.node;
        if (!before||!target?.children||!childOf(target.tag,node.tag)) throw new RangeError('Choose a compatible SVG parent');
        for(let ancestor=target;ancestor;ancestor=table.get(ancestor.key)?.parent)
          if (ancestor===node) throw new RangeError('Cannot move an SVG node into its own subtree');
        const max=target.children.length-Number(before===target), at=request.index??max;
        if (!Number.isSafeInteger(at)||at<0||at>max) throw new RangeError('SVG move index is outside its destination');
        before.children.splice(before.children.indexOf(node),1);
        target.children.splice(at,0,node);
        table.set(node.key,{node,parent:target});
      } else throw new TypeError('Unsupported vector edit for '+node.tag+': '+request.kind);
    }
    index(document);
    return document;
  }
  function describe(document) {
    const {nodes}=index(document);
    return { root:document.root.key, viewBox:viewBox(document.root.attrs.viewBox),
      elements:[...nodes.values()].map(({node,parent})=>({key:node.key,tag:node.tag,parent:parent?.key??null,
        ...(node.attrs.id && { id:node.attrs.id }), ...(node.segments && { segments:node.segments.length })})) };
  }

  return Object.freeze({format,version,parse,write,index,valid,edit,describe,matrix,multiply,point,viewBox,viewport,style,identity,
    shapeNames,maxText,definitions});
})();
if (typeof module !== 'undefined') module.exports = VectorResources;
