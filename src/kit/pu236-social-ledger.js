/* World-owned reputation and obligations. */
(function(K) {
  const W = K.world, {check,id,own,record} = W.data, Q = W.query;
  const {freeze} = K.procedural.data;
  const limit = 4096;
  const actions = {
    'adjust-reputation': 'reputation-changed',
    'open-obligation': 'obligation-opened',
    'resolve-obligation': 'obligation-resolved'
  };
  const closed = value => value==='fulfilled'||value==='released';
  const keys = (value,names) => record(value)&&Object.keys(value).every(key=>names.includes(key));
  const termsOK = value => record(value)&&JSON.stringify(value).length<=4096;
  const partiesOK = value => id(value.debtor)&&id(value.creditor)&&value.debtor!==value.creditor&&termsOK(value.terms);
  const score = (state,{subject,faction}) => own(state.reputation,subject)&&own(state.reputation[subject],faction)?
    state.reputation[subject][faction]:0;
  function validReputation(value) {
    return record(value)&&Object.keys(value).length<=limit&&Object.entries(value).every(([subject,scores])=>
      id(subject)&&record(scores)&&Object.keys(scores).length<=limit&&
      Object.entries(scores).every(([faction,score])=>id(faction)&&Number.isSafeInteger(score)));
  }

  function checkAction(action,args) {
    const valid = action==='adjust-reputation' ?
      keys(args,['subject','faction','delta'])&&id(args.subject)&&id(args.faction)&&Number.isSafeInteger(args.delta)&&args.delta!==0 :
      action==='open-obligation' ?
        keys(args,['obligation','debtor','creditor','terms'])&&id(args.obligation)&&partiesOK(args) :
        keys(args,['obligation','status'])&&id(args.obligation)&&closed(args.status);
    check(valid,'Invalid social ledger action '+action);
  }

  function apply(state,action,args,tick) {
    if (action==='adjust-reputation') {
      const {subject,faction,delta} = args, scores = own(state.reputation,subject)?state.reputation[subject]:{};
      const previous = score(state,args), value = previous+delta;
      if (!Number.isSafeInteger(value)) return {blocked:'reputation-overflow'};
      if ((!own(state.reputation,subject)&&Object.keys(state.reputation).length>=limit)||
          (!own(scores,faction)&&Object.keys(scores).length>=limit)) return {blocked:'reputation-capacity'};
      return {state:{...state,reputation:{...state.reputation,[subject]:{...scores,[faction]:value}}},
        detail:{subject,faction,previous,delta,value}};
    }
    const {obligation} = args, prior = own(state.obligations,obligation)?state.obligations[obligation]:undefined;
    let row;
    if (action==='open-obligation') {
      if (prior) return {blocked:'obligation-already-exists'};
      if (Object.keys(state.obligations).length>=limit) return {blocked:'obligation-capacity'};
      const {debtor,creditor,terms} = args;
      row = {debtor,creditor,terms,status:'open',opened:tick};
    } else {
      if (!prior) return {blocked:'obligation-missing'};
      if (prior.status!=='open') return {blocked:'obligation-already-closed'};
      row = {...prior,status:args.status,closed:tick};
    }
    return {state:{...state,obligations:{...state.obligations,[obligation]:row}},detail:{obligation,...row}};
  }

  W.runtime.register('social-ledger',config=>{
    const reputation = config?.reputation??{};
    check(keys(config??{},['reputation'])&&validReputation(reputation),'Invalid initial social ledger reputation');
    function validateState(state) {
      check(keys(state,['reputation','obligations'])&&validReputation(state.reputation)&&record(state.obligations)&&
        Object.keys(state.obligations).length<=limit&&Object.entries(state.obligations).every(([idValue,row])=>
          id(idValue)&&keys(row,['debtor','creditor','terms','status','opened','closed'])&&partiesOK(row)&&
          Number.isSafeInteger(row.opened)&&row.opened>0&&
          (row.status==='open'?row.closed===undefined:closed(row.status)&&Number.isSafeInteger(row.closed)&&row.closed>=row.opened)),
      'Invalid saved social ledger');
    }
    return {initial:()=>freeze({reputation,obligations:{}}),shareCheckpoint:true,validateState,checkAction,
      storySocial:{apply,events:actions},
      actions:Object.fromEntries(Object.entries(actions).map(([action,event])=>[action,(state,args,ctx)=>{
        const result = apply(state,action,args,ctx.tick);
        if (result.blocked) {
          ctx.emit('social-action-rejected',{action,reason:result.blocked});
          return state;
        }
        ctx.emit(event,result.detail);
        return result.state;
      }])),
      fields:{
        reputation:{type:'record',qualified:true,selector:true,read({state,args}){
          if (!Object.keys(args).length) return Q.ok(state.reputation);
          const {subject,faction} = args;
          return id(subject)&&id(faction)?Q.ok({subject,faction,value:score(state,args)}):Q.missing('Specify subject and faction','missing');
        }},
        obligations:{type:'record',qualified:true,selector:true,read({state,args:{obligation}}){
          if (obligation===undefined) return Q.ok(state.obligations);
          return own(state.obligations,obligation)?Q.ok(state.obligations[obligation]):Q.missing('Unknown obligation','missing');
        }}
      }};
  });
})(KIT);
