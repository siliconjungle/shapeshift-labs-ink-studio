/* Editable pattern programs with local frames, seeded scope, and reusable branches. */
(function (P) {
  const K=ProcessorKernel, R=FxMapRender, {fields}=K, own=Object.hasOwn;
  const {literal}=GraphControlReferences, {hash,hash01}=P.data;
  const format='ink-studio/fx-map', version=1;
  const maxVisits=16384, maxStamps=4096, maxDepth=48, maxProgramWork=10000000;
  const zero=[0,0], one=[1,1], startState=[0,0,0,0], turns=[[-.25,-.25],[.25,-.25],[-.25,.25],[.25,.25]];
  const system={position:'vec2',size:'vec2',canvasSize:'vec2',depth:'i32',quadrant:'i32',iteration:'i32',
    iterations:'i32',state:'vec4',random:'vec4',stampIndex:'i32'};
  const common={branchOffset:'vec2',rotation:'f32',scale:'vec2',state:'vec4'};
  const stampFields={offset:'vec2',size:'vec2',rotation:'f32',opacity:'f32',color:'vec4'};
  const iterateFields={count:'i32',step:'vec2',turn:'f32',shrink:'f32'};
  const reserved=['map','width','height','background','options',...Object.keys(system)];
  const id=n=>typeof n==='string'&&/^[a-z][a-z0-9_.-]{0,63}$/i.test(n)&&!['__proto__','constructor','prototype'].includes(n);
  const types=new Set(['colorImage','grayImage']);
  const unit=n=>Number.isFinite(n)&&n>=0&&n<=1;
  const finite=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const vector=(v,count,check)=>Array.isArray(v)&&v.length===count&&Array.from(v).every(check);
  const offset=v=>vector(v,2,n=>finite(n,-32,32));
  const scale=v=>vector(v,2,n=>finite(n,.0001,8));
  const angle=n=>finite(n,-1e6,1e6);
  const tuple=(v,fallback)=>Array.isArray(v)?v.slice():fallback;
  const reference=(v,nodes)=>v===null||typeof v==='string'&&nodes.has(v);

  function transform(frame,delta,factors,degrees) {
    const {x,y,a,b,c,d}=frame, theta=(degrees%360)*Math.PI/180, u=Math.cos(theta), v=Math.sin(theta);
    return {...frame,x:x+a*delta[0]+c*delta[1],y:y+b*delta[0]+d*delta[1],
      a:(a*u+c*v)*factors[0],b:(b*u+d*v)*factors[0],
      c:(c*u-a*v)*factors[1],d:(d*u-b*v)*factors[1]};
  }

  function child(frame,part,node,patch={}) {
    const segment=part+'/'+node;
    return {...frame,...patch,path:frame.path+'/'+segment,seed:hash(segment,frame.seed)};
  }

  function compile(source) {
    if(!fields(source,['format','version','mode','root','nodes','patterns','images','parameters','state'])||
        source.format!==format||source.version!==version||!['color','gray'].includes(source.mode??'color'))
      throw new TypeError('Expected Ink Studio FX Map version 1');
    const mode=source.mode??'color', initial=tuple(source.state,startState);
    if(source.state!==undefined&&!vector(source.state,4,Number.isFinite))
      throw new TypeError('FX Map initial state needs four finite lanes');
    const images=new Map(K.entries(source.images??{},16,reserved,'FX Map images'));
    for(const [name,type] of images)if(!types.has(type))throw new TypeError('FX Map image '+name+' needs colorImage or grayImage');
    const parameters=K.parameters(source.parameters??{},[...reserved,...images.keys()],'FX Map');
    const patterns=new Map(K.entries(source.patterns??{},128,[],'FX Map patterns').map(([name,entry])=>{
      if(fields(entry,['shape'])&&own(entry,'shape'))
        return [name,{shape:P.shapeLibrary.compile(P.shapeLibrary.define(entry.shape))}];
      if(!fields(entry,['image','filter','alpha','wrapU','wrapV','uv'])||!images.has(entry.image))
        throw new TypeError('FX Map pattern '+name+' needs one signed shape or declared image');
      return [name,{image:entry.image,options:R.imageOptions(entry)}];
    }));
    let readsTime=false;
    function compileProgram(program,outputs,label) {
      if(program===undefined)return null;
      const plan=P.valueProcessor.compile(program);
      for(const [name,socket] of Object.entries(plan.sockets)){
        const type=own(system,name)?system[name]:parameters.get(name)?.type;
        if(!type||socket.type!==K.socketTypes[type])
          throw new TypeError('FX Map '+label+' has unavailable or incompatible program input '+name);
      }
      for(const [name,port] of Object.entries(plan.ports)){
        if(!own(outputs,name)||!P.graphTypes.compatible(port,K.socketTypes[outputs[name]]))
          throw new TypeError('FX Map '+label+' has incompatible program output '+name);
      }
      readsTime ||= plan.report.readsTime;
      return plan;
    }

    const nodes=new Map(K.entries(source.nodes,512,[],'FX Map nodes',true));
    if(!nodes.has(source.root))throw new TypeError('FX Map needs the name of a root node');
    function settings(values,label) {
      if(!offset(values.branchOffset)||!angle(values.rotation)||!scale(values.scale)||!vector(values.state,4,Number.isFinite))
        throw new RangeError('FX Map '+label+' needs bounded branch offsets, rotation, scale and four state lanes');
      return values;
    }
    function stampSettings(values,label) {
      if(!offset(values.offset)||!scale(values.size)||!angle(values.rotation)||!unit(values.opacity))
        throw new RangeError('FX Map '+label+' needs bounded stamp placement, rotation and opacity');
      return values;
    }

    function stampRows(stamps,node) {
      if(!Array.isArray(stamps)||stamps.length>32)throw new TypeError('FX Map '+node+' needs up to 32 named stamps');
      const used=new Set();
      return Array.from(stamps,raw=>{
        if(!fields(raw,['id','pattern','offset','size','rotation','opacity','color','blend','program'])||
            !id(raw.id)||used.has(raw.id)||!patterns.has(raw.pattern))
          throw new TypeError('FX Map '+node+' has an invalid or duplicate stamp');
        used.add(raw.id);
        const {id:stamp,pattern,rotation=0,opacity=1,color='#ffffff',blend='normal'}=raw;
        const label=node+'/'+stamp, values=stampSettings({offset:raw.offset===undefined?zero:raw.offset,
          size:raw.size===undefined?one:raw.size,rotation,opacity},label);
        return {id:stamp,pattern,values:{...values,offset:values.offset.slice(),size:values.size.slice()},
          tint:R.color(color),blend:R.blend(blend),
          program:compileProgram(raw.program,stampFields,label)};
      });
    }

    function iterateSettings(values,limit,label) {
      if(!Number.isSafeInteger(values.count)||values.count<0||values.count>limit||!offset(values.step)||
          !angle(values.turn)||!finite(values.shrink,.125,2))
        throw new RangeError('FX Map '+label+' exceeds its iteration bound or has invalid step, turn or shrink');
      return values;
    }

    for(const [name,raw] of nodes){
      const kind=raw?.kind, extra=kind==='quadrant'?['children','stamps']:
        kind==='iterate'?['body','base','limit','stepProgram',...Object.keys(iterateFields)]:
          kind==='switch'?['whenFalse','whenTrue','select']:null;
      if(!extra||!fields(raw,['kind','program',...Object.keys(common),...extra]))
        throw new TypeError('Invalid FX Map node '+name);
      const transforms=settings({
        branchOffset:raw.branchOffset===undefined?zero:raw.branchOffset,
        rotation:raw.rotation??0,scale:raw.scale===undefined?one:raw.scale,state:raw.state??startState
      },name);
      const region={branchOffset:transforms.branchOffset.slice(),rotation:transforms.rotation,
        scale:transforms.scale.slice(),...(raw.state!==undefined&&{state:transforms.state.slice()})};
      const program=compileProgram(raw.program,{...common,...(kind==='iterate'?iterateFields:kind==='switch'?{select:'bool'}:{})},name);
      let definition, links;
      if(kind==='quadrant'){
        const next=raw.children??null;
        links=Array.isArray(next)?Array.from(next):Array(4).fill(next);
        if(links.length!==4)throw new TypeError('FX Map '+name+' needs four child slots or one repeated child');
        definition={stamps:stampRows(raw.stamps??[],name),children:links};
      }else if(kind==='iterate'){
        const {count=1,limit=64,step=zero,turn=0,shrink=1,body,base=null}=raw;
        if(!Number.isSafeInteger(limit)||limit<1||limit>512||body===null||!nodes.has(body))
          throw new TypeError('FX Map '+name+' needs a loop body and a literal limit from 1 to 512');
        const controls=iterateSettings({count,step,turn,shrink},limit,name);
        links=[base,body];
        definition={controls:{...controls,step:step.slice()},limit,base,body,
          stepProgram:compileProgram(raw.stepProgram,{state:'vec4'},name+' step')};
      }else{
        const {select=false,whenFalse=null,whenTrue=null}=raw;
        if(typeof select!=='boolean')throw new TypeError('FX Map '+name+' selection must be Boolean');
        links=[whenFalse,whenTrue];
        definition={select,branches:links};
      }
      if(links.some(link=>!reference(link,nodes)))throw new RangeError('FX Map '+name+' references an unknown node');
      nodes.set(name,{kind,region,program,links,...definition});
    }
    const finished=new Map(), active=new Set();
    function depth(name,level) {
      if(level>maxDepth)throw new RangeError('FX Map exceeds its hierarchy depth');
      if(active.has(name))throw new TypeError('FX Map cycle at '+name);
      if(finished.has(name))return finished.get(name);
      active.add(name);
      const result=1+Math.max(0,...nodes.get(name).links.filter(v=>v!==null).map(next=>depth(next,level+1)));
      active.delete(name);
      if(result>maxDepth)throw new RangeError('FX Map exceeds its hierarchy depth');
      finished.set(name,result);
      return result;
    }
    for(const name of nodes.keys())depth(name,1);

    const sockets=Object.freeze({...Object.fromEntries(images),...K.parameterSockets(parameters)});
    const ports=Object.freeze({value:mode==='gray'?'grayImage':'colorImage',coverage:'grayImage',stampId:'grayImage',layout:'record'});
    const root=source.root;
    function run(request) {
      if(!fields(request,['width','height','images','parameters','options','background','seed','time']))
        throw new TypeError('Invalid FX Map run request');
      const {width,height,images:inputs={},parameters:bindings={},options={},background=null,seed=0,time=0}=request;
      const config=R.settings(options,width,height), resolved=config.seed??seed;
      if(!Number.isSafeInteger(resolved)||!Number.isFinite(time)||!fields(inputs,[...images.keys()])||
          background!==null&&!R.validImage(background))
        throw new TypeError('FX Map needs typed images, an integer seed and finite time');
      for(const [name,type] of images)if(!P.graphTypes.validator(type)(inputs[name]))
        throw new TypeError('FX Map image '+name+' needs '+type);
      const bound=K.resolveParameters(parameters,bindings,'FX Map');
      const user=Object.fromEntries([...parameters.keys()].map((name,i)=>[name,bound[i]]));
      const {base,get:findPattern}=R.preparedPatterns(new Map(patterns),inputs,background);
      let visits=0, programWork=0;
      const stamps=[], layout=[];
      function evaluate(plan,frame,stampIndex) {
        if(!plan)return {};
        programWork+=plan.report.work;
        if(programWork>maxProgramWork)throw new RangeError('FX Map exceeds its parameter program budget');
        const {x,y,a,b,c,d,seed,depth,quadrant,iteration,iterations,state}=frame;
        const context={position:[x,y],size:[Math.hypot(a,b),Math.hypot(c,d)],canvasSize:[width,height],
          depth,quadrant,iteration,iterations,state,stampIndex,
          random:Array.from({length:4},(_,index)=>hash01('lane/'+index,seed))};
        const parameters=Object.fromEntries(Object.keys(plan.sockets).map(name=>[name,own(context,name)?context[name]:user[name]]));
        return plan.run({parameters,time:plan.report.readsTime?time:0,seed:seed|0});
      }
      function paint(name,node,frame) {
        for(let i=0;i<node.stamps.length;i++){
          const stamp=node.stamps[i], scoped=child(frame,'stamp',stamp.id);
          const dynamic=evaluate(stamp.program,scoped,i);
          const {offset,size,rotation,opacity}=stampSettings({...stamp.values,...dynamic},name+'/'+stamp.id);
          const tint=own(dynamic,'color')?R.color(dynamic.color):stamp.tint;
          if(opacity===0||tint[3]===0)continue;
          if(stamps.length>=maxStamps)throw new RangeError('FX Map exceeds its stamp budget');
          const posed=transform(frame,offset,size,rotation), id=stamps.length+1;
          stamps.push({id,frame:posed,pattern:findPattern(stamp.pattern),tint,opacity,blend:stamp.blend});
          layout.push({id,pattern:stamp.pattern,path:scoped.path,node:name,stamp:stamp.id,seed:scoped.seed,
            position:[posed.x,posed.y],axes:[posed.a,posed.b,posed.c,posed.d],rotation,opacity,
            depth:frame.depth,quadrant:frame.quadrant,iteration:frame.iteration,state:frame.state.slice()});
        }
      }
      function visit(name,scope) {
        if(name===null)return;
        if(++visits>maxVisits)throw new RangeError('FX Map exceeds its expanded node budget');
        const node=nodes.get(name), values=evaluate(node.program,scope,-1);
        const region=settings({state:scope.state,...node.region,...values},name);
        const frame=transform({...scope,state:region.state},region.branchOffset,region.scale,region.rotation);
        if(![frame.x,frame.y,frame.a,frame.b,frame.c,frame.d].every(n=>finite(n,-1e8,1e8)))
          throw new RangeError('FX Map '+name+' has an out-of-range transform');
        if(node.kind==='quadrant'){
          paint(name,node,frame);
          for(let i=0;i<4;i++){
            const next=node.children[i];
            if(next!==null)visit(next,child(transform(frame,turns[i],[.5,.5],0),'q'+i,next,{depth:frame.depth+1,quadrant:i}));
          }
        }else if(node.kind==='switch'){
          const selector=values.select??node.select, next=node.branches[selector?1:0];
          if(next!==null)visit(next,child(frame,selector?'true':'false',next));
        }else {
          const {base,body,limit,stepProgram}=node;
          const {count,step,turn,shrink}=iterateSettings({...node.controls,...values},limit,name);
          if(base!==null)visit(base,child(frame,'base',base));
          let state=frame.state;
          for(let i=0;i<count;i++){
            const amount=shrink**i, dx=i*step[0], dy=i*step[1];
            const pass=child(transform(frame,[dx,dy],[amount,amount],i*turn),'i'+i,body,
              {iteration:i,iterations:count,state});
            state=evaluate(stepProgram,pass,-1).state??state;
            visit(body,{...pass,state});
          }
        }
      }
      visit(root,{x:.5,y:.5,a:1,b:0,c:0,d:1,depth:0,quadrant:-1,iteration:-1,iterations:0,
        state:initial,seed:hash(root,resolved),path:root});
      const {work,...maps}=R.render({width,height,mode,stamps,base,config});
      return {...maps,layout:P.data.freeze({format:'ink-studio/fx-map-layout',version:1,
        width,height,seed:resolved,visits,work,programWork,stamps:layout})};
    }
    return Object.freeze({sockets,ports,readsTime,run});
  }

  const operations=Object.freeze({
    'image.fxMap':{
      description:'Draw hierarchical signed and image patterns with Quadrant, Iterate, Switch, and seeded local programs.',
      specialize(node){
        const plan=compile(literal(node,'map')), imageNames=new Set(Object.entries(plan.sockets)
          .filter(([,type])=>types.has(type)).map(([name])=>name));
        return {inputs:{map:'record',width:'pixelCount',height:'pixelCount',background:{type:'any',default:null},
          options:{type:'record',default:{}},...plan.sockets},outputs:plan.ports,time:plan.readsTime,seed:'options',
          run({map,width,height,background,options,...values},{time,seed}){
            const images={}, parameters={};
            for(const [key,value] of Object.entries(values))(imageNames.has(key)?images:parameters)[key]=value;
            return plan.run({width,height,background,options,images,parameters,time,seed});
          }};
      }
    }
  });
  P.fxMap=Object.freeze({format,version,compile,operations});
})(KIT.procedural);
