/* Put performance echo and room after the take selection on the transport clock. */
(function (P) {
  const S=P.mediaGraphSupport,A=P.musicProduction,G=P.musicGestures;
  const {check}=P.musicInstruments;
  const contains=(rows,time)=>rows?.some(row=>time>=row.startTime-1e-8 && time<row.endTime-1e-8);

  S.sessionEffects=(rate,feeds)=>{
    const {room,signature}=S.musicSessionModel;
    const rooms=new Map(), echoes=new Map();
    function register(lane,source) {
      let reverb, echo;
      if (source.roomSpec) {
        const key=signature([source.roomSpec,source.roomCuts]);
        reverb=rooms.get(key);
        if (!reverb) {
          check(rooms.size<96,'Session takes exceed the active room-state budget');
          reverb={process:A.makeSessionRoom(source.roomSpec,rate),cuts:source.roomCuts,l:0,r:0,active:false};
          rooms.set(key,reverb);
        }
      }
      if (source.echo) {
        const key=signature([lane,source.echo,source.roomSpec,source.roomCuts,source.trackCuts]);
        echo=echoes.get(key);
        if (!echo) {
          check(echoes.size<128,'Session takes exceed the active echo-state budget');
          echo={spec:source.echo,process:G.tapeEcho(source.echo,rate),cuts:source.trackCuts,room:reverb,
            l:0,r:0,send:0,weight:0,lastSend:0,active:false,dest:feeds[lane]};
          echoes.set(key,echo);
        }
      }
      return {reverb,echo};
    }
    function start() {
      for (const state of rooms.values()) state.l=state.r=0;
      for (const state of echoes.values()) state.l=state.r=state.send=state.weight=0;
    }
    function add({reverb,echo},l,r,send,drive,weight) {
      if (reverb && send) {
        reverb.l+=l*send;
        reverb.r+=r*send;
      }
      if (echo) {
        echo.l+=l*drive;
        echo.r+=r*drive;
        echo.weight+=weight;
        echo.send+=send*weight;
      }
    }
    function finish(at,frame) {
      const time=at/rate;
      for (const echo of echoes.values()) {
        if (echo.weight) echo.lastSend=echo.send/echo.weight;
        if (contains(echo.cuts,time)) {
          if (echo.active) {
            echo.process=G.tapeEcho(echo.spec,rate);
            echo.active=false;
          }
          continue;
        }
        echo.active ||= echo.l!==0 || echo.r!==0;
        if (!echo.active) continue;
        const out=echo.process(frame,echo.l,echo.r,1);
        echo.dest[0]+=out[0];
        echo.dest[1]+=out[1];
        if (echo.room && echo.lastSend) {
          echo.room.l+=out[0]*echo.lastSend;
          echo.room.r+=out[1]*echo.lastSend;
        }
      }
      const wet=feeds[room];
      wet[0]=wet[1]=0;
      for (const state of rooms.values()) {
        state.active ||= state.l!==0 || state.r!==0;
        if (!state.active) continue;
        const out=state.process(state.l,state.r,contains(state.cuts,time));
        wet[0]+=out[0];
        wet[1]+=out[1];
      }
    }
    const save=map=>[...map].filter(([,state])=>state.active || state.lastSend)
      .map(([key,{active,lastSend,process}])=>[key,active,lastSend,active ? process.snapshot() : null]);
    function load(map,rows) {
      for (const [key,active,lastSend,snapshot] of rows) {
        const state=map.get(key);
        state.active=active;
        state.lastSend=lastSend;
        if (snapshot) state.process.restore(snapshot);
      }
    }
    function prepare(callback) {
      const oldRooms=new Set(rooms.keys()), oldEchoes=new Set(echoes.keys());
      try {return callback();}
      catch (error) {
        for (const key of rooms.keys()) if (!oldRooms.has(key)) rooms.delete(key);
        for (const key of echoes.keys()) if (!oldEchoes.has(key)) echoes.delete(key);
        throw error;
      }
    }
    return {register,prepare,start,add,finish,
      snapshot:()=>({room:save(rooms),echo:save(echoes)}),
      restore(snapshot){load(rooms,snapshot.room);load(echoes,snapshot.echo);}};
  };
})(KIT.procedural);
