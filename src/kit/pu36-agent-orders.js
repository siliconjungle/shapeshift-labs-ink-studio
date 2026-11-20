/* Data-defined tasks over agent movement, queries, events, and resource transfers. */
(function(K){
  const W=K.world, Q=W.query, {check,id,record,own,equal,vector}=W.data;
  const {freeze}=K.procedural.data;
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const tick=n=>integer(n,0,10000000);
  const keys=(obj,allowed)=>record(obj)&&Object.keys(obj).every(key=>allowed.includes(key));
  const site=value=>vector(value)||keys(value,['entity','socket'])&&id(value.entity)&&
    (value.socket===undefined||id(value.socket));
  const keyRef=(value,key)=>keys(value,[key])&&id(value[key]);
  const modes=['append','interrupt','replace'];
  const outcomes=['succeeded','failed','cancelled'];
  const phases=['queued','starting','moving','waiting','blocked','settling',...outcomes];
  const blank=freeze({serial:0,active:null,paused:[],queue:[],outcomes:[]});
  const runnable=book=>Boolean(book&&(book.active||book.paused.length||book.queue.length));
  const holding=book=>own(book,'priorTask');

  function create(config){
    check(keys(config,['tasks','maxQueued','historyLimit']),'Invalid agent order settings');
    const {tasks,maxQueued=16,historyLimit=16}=config;
    check(integer(maxQueued,1,256)&&integer(historyLimit,1,64)&&record(tasks)&&
      integer(Object.keys(tasks).length,1,256),'Orders need a bounded task catalog and queue');
    const fields=new Set(), staticTransfers=[];
    let validateTransfer, validateReservation;
    const catalog=new Map(Object.entries(tasks).map(([name,spec])=>{
      check(id(name)&&keys(spec,['steps'])&&Array.isArray(spec.steps)&&integer(spec.steps.length,1,32),'Invalid order task '+name);
      const targets=new Set(), params=new Set();
      function target(value){
        if(keyRef(value,'target'))targets.add(value.target);
        else check(site(value),'Invalid order target in '+name);
      }
      for(const step of spec.steps){
        switch(step?.op){
          case 'move':
            check(keys(step,['op','at']),'Invalid order move in '+name);
            target(step.at);
            break;
          case 'wait':
            check(keys(step,['op','ticks','field','at','args','when'])&&(step.ticks===undefined||tick(step.ticks))&&
              (step.field!==undefined||step.ticks!==undefined)&&
              (step.field!==undefined||(step.at===undefined&&step.args===undefined&&step.when===undefined)),
            'Invalid order wait in '+name);
            if(step.field!==undefined){
              check(typeof step.field==='string'&&step.field.length>0&&step.field.length<=193&&
                (step.args===undefined||record(step.args)),'Invalid order wait field in '+name);
              Q.condition(step.when,null);
              fields.add(step.field);
              if(step.at!==undefined)target(step.at);
            }
            break;
          case 'emit':
            check(keys(step,['op','kind','data'])&&id(step.kind)&&(step.data===undefined||record(step.data)),
              'Invalid order event in '+name);
            break;
          case 'transfer':{
            check(keys(step,['op','from','to','amount','mode'])&&(step.mode===undefined||['exact','partial'].includes(step.mode)),
              'Invalid order transfer in '+name);
            const refs=[step.from,step.to,step.amount].filter(value=>keyRef(value,'param'));
            for(const ref of refs)params.add(ref.param);
            for(const value of [step.from,step.to])if(!keyRef(value,'param'))W.data.endpoint(value);
            check(keyRef(step.amount,'param')||Number.isFinite(step.amount)||vector(step.amount,2)||vector(step.amount),
              'Invalid order transfer amount in '+name);
            staticTransfers.push({step,parameterized:refs.length>0});
            break;
          }
          default: throw Error('Unknown order task step in '+name);
        }
      }
      return [name,{steps:spec.steps,targets:[...targets].sort(),params:[...params].sort()}];
    }));

    const reference=(value,bag,kind)=>value?.[kind]!==undefined?bag[value[kind]]:value;
    function transfer(step,order,requestId){
      const get=value=>reference(value,order.params,'param');
      return {from:get(step.from),to:get(step.to),amount:get(step.amount),mode:step.mode??'exact',
        ...(requestId&&{id:requestId})};
    }
    function orderShape(order){
      const spec=catalog.get(order.task);
      check(spec&&(order.id===undefined||id(order.id))&&
        (order.timeout===undefined||integer(order.timeout,1,10000000))&&
        (order.priority===undefined||W.routeRequests.priority(order.priority)),'Invalid agent order');
      const {targets={},params={}}=order;
      if(order.reservation!==undefined){
        W.reservations.checkSpec(order.reservation);
        validateReservation?.(order.reservation);
      }
      const orderSite=value=>site(value)||keyRef(value,'claim')&&own(order.reservation?.require,value.claim);
      check(keys(targets,spec.targets)&&spec.targets.every(key=>orderSite(targets[key]))&&
        keys(params,spec.params)&&spec.params.every(key=>own(params,key)),'Invalid targets or parameters for order '+order.task);
      if(validateTransfer)for(const step of spec.steps)if(step.op==='transfer')validateTransfer(transfer(step,{params}));
    }
    function checkIssue(args){
      check(keys(args,['agent','generation','mode','order'])&&(args.mode===undefined||modes.includes(args.mode))&&
        keys(args.order,['id','task','targets','params','timeout','priority','reservation']),'Expected an order and a valid queue mode');
      orderShape(args.order);
    }
    function checkCancel(args){
      check(keys(args,['agent','generation','order'])&&(args.order===undefined||id(args.order)||
        integer(args.order,1,Number.MAX_SAFE_INTEGER)),'Expected an order ID or sequence');
    }
    function emit(ctx,agent,kind,order,detail={}){
      ctx.emit(kind,{agent:agent.id,generation:agent.generation,entity:agent.entity,
        sequence:order.sequence,order:order.id??null,task:order.task,at:agent.position,...detail});
    }
    function finish(book,order,phase,reason,agent,ctx){
      const lastBlocker=reason==='timeout'&&order.reason?{lastBlocker:order.reason}:{};
      const entry={...order,phase,reason,ended:ctx.tick,...lastBlocker};
      emit(ctx,agent,'order-'+phase,entry,{reason,results:entry.results,...lastBlocker});
      return {...book,outcomes:[...book.outcomes,entry].slice(-historyLimit),
        ...(entry.reservation&&phase==='succeeded'&&{lastReservedSuccess:entry.sequence})};
    }
    function cancel(book,selection,agent,ctx,reason='cancelled'){
      const matches=order=>order&&(selection===undefined||order.sequence===selection||order.id===selection);
      const removed=[book.active,...book.paused,...book.queue].filter(matches);
      if(!removed.length){
        check(selection===undefined,'Unknown pending order '+selection);
        return book;
      }
      let next={...book,active:matches(book.active)?null:book.active,
        paused:book.paused.filter(order=>!matches(order)),queue:book.queue.filter(order=>!matches(order))};
      for(const order of removed)next=finish(next,order,'cancelled',reason,agent,ctx);
      return next;
    }
    function issue(agent,{mode='append',order},ctx){
      let book=agent.orders??blank;
      if(mode==='replace')book=cancel(book,undefined,agent,ctx,'replaced');
      check(order.id===undefined||![book.active,...book.paused,...book.queue,...book.outcomes].some(entry=>entry?.id===order.id),
        'Duplicate retained order ID '+order.id);
      const waiting=book.queue.length+book.paused.length+Number(mode==='append'?runnable(book):Boolean(book.active));
      check(waiting<=maxQueued,'Agent order queue capacity exceeded');
      const sequence=book.serial+1;
      check(Number.isSafeInteger(sequence),'Agent order sequence exhausted');
      const entry={targets:{},params:{},...order,sequence,issued:ctx.tick,started:null,step:0,entered:0,
        elapsed:0,lastTick:null,phase:'queued',reason:null,results:[]};
      if(!holding(book))book={...book,priorTask:agent.task,
        ...(agent.routing&&{priorPriority:agent.routePriority})};
      if(mode==='interrupt'&&book.active)
        emit(ctx,agent,'order-interrupted',book.active,{by:sequence});
      emit(ctx,agent,'order-issued',entry,{mode});
      return mode==='append'&&runnable(book)?{...book,serial:sequence,queue:[...book.queue,entry]}:
        {...book,serial:sequence,active:entry,paused:book.active?[book.active,...book.paused]:book.paused};
    }
    function pop(book,agent,ctx){
      if(book.active||!runnable(book))return book;
      if(book.paused.length){
        const [active,...paused]=book.paused;
        if(active.started!==null)emit(ctx,agent,'order-resumed',active);
        return {...book,active,paused};
      }
      const [active,...queue]=book.queue;
      return {...book,active,queue};
    }
    function status(entry,phase,reason=null){
      return entry.phase===phase&&entry.reason===reason?entry:{...entry,phase,reason};
    }
    function completed(book,entry,result,agent,ctx){
      const next={...entry,step:entry.step+1,entered:entry.elapsed,results:[...entry.results,{...result,tick:ctx.tick}]};
      return next.step===catalog.get(entry.task).steps.length?
        finish({...book,active:null},next,'succeeded',null,agent,ctx):
        {...book,active:status(next,'starting')};
    }

    function claim(ctx,agent,entry){
      if(!entry?.reservation)return null;
      return ctx.query.probe(entry.reservation.board+'/claim',undefined,{
        system:ctx.id,agent:agent.id,generation:agent.generation,sequence:entry.sequence
      }).value;
    }
    function advance(book,agent,ctx,movement){
      if(!runnable(book)){
        const row=movement.hold(agent,book.priorTask,book.priorPriority);
        if(row.clearing)return {book,row:row.agent};
        const {priorTask,priorPriority,...rest}=book;
        return {book:rest,row:row.agent};
      }
      book=pop(book,agent,ctx);
      let entry=book.active;
      if(entry.started===null){
        entry={...entry,started:ctx.tick};
        emit(ctx,agent,'order-started',entry);
      }
      const advanced=entry.lastTick!==ctx.tick;
      if(advanced)entry={...entry,lastTick:ctx.tick,elapsed:entry.elapsed+1};
      book={...book,active:entry};
      const step=catalog.get(entry.task).steps[entry.step];
      if(entry.timeout!==undefined&&entry.elapsed>entry.timeout)
        return {row:movement.hold(agent,entry.task).agent,
          book:finish({...book,active:null},entry,'failed','timeout',agent,ctx)};
      const reservation=claim(ctx,agent,entry);
      if(entry.reservation&&reservation?.status!=='held'){
        const row=movement.hold(agent,entry.task).agent;
        return {row,book:reservation?.status==='failed'?
          finish({...book,active:null},entry,'failed',reservation.reason,row,ctx):
          {...book,active:status(advanced?{...entry,entered:entry.entered+1}:entry,
            'waiting',reservation?.reason??'reservation-pending')}};
      }
      function at(value){
        const target=reference(value,entry.targets,'target');
        return keyRef(target,'claim')?reservation?.grants.find(grant=>grant.claim===target.claim)?.at:target;
      }
      if(step.op==='move'){
        const target=at(step.at), point=target===undefined?null:ctx.query.target(target)?.point;
        const moved=point?movement.move(agent,point,entry):movement.hold(agent,entry.task);
        const next=moved.arrived?completed(book,entry,{op:'move',at:moved.agent.position},moved.agent,ctx):
          {...book,active:status(entry,point?moved.phase:'blocked',point?moved.reason:'target-missing')};
        return {row:moved.agent,book:next};
      }
      const {agent:row,clearing}=movement.hold(agent,entry.task);
      if(clearing)return {row,book:{...book,active:status(entry,'waiting','crossing')}};
      if(step.op==='emit'){
        emit(ctx,row,step.kind,entry,{targets:entry.targets,params:entry.params,data:step.data??{},
          ...(reservation&&{grants:reservation.grants})});
        return {row,book:completed(book,entry,{op:'emit',kind:step.kind},row,ctx)};
      }
      if(step.op==='transfer')return {row,book:{...book,active:status(entry,'settling')}};
      if(entry.elapsed-entry.entered<(step.ticks??0))
        return {row,book:{...book,active:status(entry,'waiting','duration')}};
      if(step.field!==undefined){
        const target=step.at===undefined?row.position:at(step.at);
        if(target===undefined)return {row,book:{...book,active:status(entry,'waiting','target-missing')}};
        const sample=ctx.query.probe(step.field,target,step.args);
        if(sample.status!=='ok'||!Q.condition(step.when,sample.value))
          return {row,book:{...book,active:status(entry,'waiting',sample.status==='ok'?'condition':'field-'+sample.status)}};
      }
      return {row,book:completed(book,entry,{op:'wait',...(step.field!==undefined&&{field:step.field})},row,ctx)};
    }
    function pending(agent){
      const active=agent.orders?.active;
      if(active?.phase==='settling'){
        const step=catalog.get(active.task).steps[active.step];
        return transfer(step,active,'order.'+agent.generation+'.'+active.sequence+'.'+active.step);
      }
    }
    function receive(agent,receipt,ctx){
      const book=agent.orders, entry=book.active, result={op:'transfer',receipt,tick:ctx.tick};
      return receipt.status==='blocked'?
        finish({...book,active:null},{...entry,results:[...entry.results,result]},'failed','transfer-blocked',agent,ctx):
        completed(book,entry,result,agent,ctx);
    }

    function validate(book){
      if(book===undefined)return;
      check(record(book)&&integer(book.serial,1,Number.MAX_SAFE_INTEGER)&&
        (!holding(book)||book.priorTask===null||id(book.priorTask))&&
        (book.priorPriority===undefined||holding(book)&&W.routeRequests.priority(book.priorPriority))&&
        (book.active===null||record(book.active))&&
        Array.isArray(book.paused)&&Array.isArray(book.queue)&&book.paused.length+book.queue.length<=maxQueued&&
        Array.isArray(book.outcomes)&&book.outcomes.length<=historyLimit&&(!runnable(book)||holding(book))&&
        (book.lastReservedSuccess===undefined||integer(book.lastReservedSuccess,1,book.serial)),
      'Invalid saved agent orders');
      const sequences=new Set(), labels=new Set();
      function entry(row,terminal){
        check(record(row)&&integer(row.sequence,1,book.serial)&&!sequences.has(row.sequence)&&
          (row.id===undefined||!labels.has(row.id))&&tick(row.issued)&&
          (row.started===null||tick(row.started)&&row.started>=row.issued)&&
          (row.lastTick===null?row.started===null:tick(row.lastTick)&&row.started!==null&&row.lastTick>=row.started)&&
          (terminal?outcomes.includes(row.phase)&&tick(row.ended)&&row.ended>=(row.lastTick??row.issued):
            phases.includes(row.phase)&&!outcomes.includes(row.phase)&&!own(row,'ended'))&&
          (row.reason===null||id(row.reason))&&(row.lastBlocker===undefined||row.reason==='timeout'&&id(row.lastBlocker))&&
          tick(row.elapsed)&&integer(row.entered,0,row.elapsed)&&
          Array.isArray(row.results),'Invalid saved order entry');
        orderShape(row);
        const steps=catalog.get(row.task).steps;
        const blockedTransfer=row.phase==='failed'&&row.reason==='transfer-blocked';
        check(integer(row.step,0,steps.length)&&
          (row.phase==='succeeded'?row.step===steps.length:row.step<steps.length)&&
          (row.phase!=='settling'||steps[row.step].op==='transfer')&&
          row.results.length===row.step+Number(blockedTransfer)&&row.results.every((result,i)=>{
            if(!record(result)||!tick(result.tick)||result.op!==steps[i]?.op)return false;
            if(result.op==='move')return vector(result.at);
            if(result.op==='emit')return result.kind===steps[i].kind;
            if(result.op!=='transfer')return true;
            const request=transfer(steps[i],row), receipt=result.receipt;
            return record(receipt)&&receipt.tick===result.tick&&receipt.from===request.from&&receipt.to===request.to&&
              receipt.mode===request.mode&&equal(receipt.requested,request.amount)&&
              (Array.isArray(request.amount)?vector(receipt.applied,request.amount.length):Number.isFinite(receipt.applied))&&
              (i===row.step?receipt.status==='blocked':receipt.status==='full'||request.mode==='partial'&&receipt.status==='partial');
          }),'Invalid saved order progress');
        if(row.sequence===book.lastReservedSuccess)
          check(terminal&&row.phase==='succeeded'&&row.reservation,'Invalid saved reservation completion');
        sequences.add(row.sequence);
        if(row.id!==undefined)labels.add(row.id);
      }
      if(book.active)entry(book.active,false);
      for(const row of book.paused)entry(row,false);
      for(const row of book.queue){
        entry(row,false);
        check(row.phase==='queued'&&row.started===null&&row.step===0,'Invalid saved order queue');
      }
      for(const row of book.outcomes)entry(row,true);
    }
    return {checkIssue,checkCancel,issue,cancel,advance,validate,pending,receive,claim,
      checkReservations(validate){validateReservation=validate;},
      tasks:Object.fromEntries(catalog),hasTransfers:staticTransfers.length>0,
      checkFields(query){
        for(const field of fields)check(query.field(field),'Unknown order condition field '+field);
      },
      checkTransfers(validate){
        validateTransfer=validate;
        for(const {step,parameterized} of staticTransfers)if(!parameterized)validate(transfer(step,{params:{}}));
      }};
  }
  W.agentOrders=Object.freeze({create,blank,runnable,holding});
})(KIT);
