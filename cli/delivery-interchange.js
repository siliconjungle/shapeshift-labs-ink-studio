/* Sample-addressed cue sheets and a portable premaster timeline. */
function editorialTimeline({title,sampleRate,frames,timeReference,stems,cues,picture,dialogue=[]}) {
  const rt=(value,rate=sampleRate)=>({OTIO_SCHEMA:'RationalTime.1',rate,value});
  const range=(start,duration,rate)=>({OTIO_SCHEMA:'TimeRange.1',start_time:rt(start,rate),duration:rt(duration,rate)});
  const item=(name,source_range=null)=>({name,metadata:{},source_range,effects:[],markers:[],enabled:true,color:null});
  const external=(name,file,length,rate)=>({OTIO_SCHEMA:'ExternalReference.1',metadata:{},name,
    available_range:range(0,length,rate),available_image_bounds:null,target_url:file});
  const clip=(name,reference,start,length,rate,ink)=>({...item(name,range(start,length,rate)),
    OTIO_SCHEMA:'Clip.1',media_reference:reference,...(ink&&{metadata:{ink}})});
  const track=(name,kind,children,enabled=true)=>({...item(name),OTIO_SCHEMA:'Track.1',kind,children,enabled});
  const origin=Number(timeReference);
  const audio=Object.entries(stems).map(([role,file])=>
    track(role,'Audio',[clip(role,external(role,file,frames),0,frames)]));
  const isolated=dialogue.filter(line=>line.clip).map(line=>{
    const {file,offsetSample,sourceIn,durationSamples,sourceSamples}=line.clip;
    const gap=offsetSample ? [{...item('Lead-in',range(0,offsetSample)),OTIO_SCHEMA:'Gap.1'}] : [];
    const name=line.speaker+' · '+line.id;
    return track(name,'Audio',[...gap,clip(name,external(name,file,sourceSamples),sourceIn,durationSamples,
      sampleRate,{beatId:line.beatId,text:line.text})],false);
  });
  let video=[];
  if (picture) {
    const {fps,frameCount,shots,file}=picture;
    const reference=file ? external('Picture',file,frameCount,fps) : {
      OTIO_SCHEMA:'ImageSequenceReference.1',metadata:{},name:'Picture frames',available_image_bounds:null,
      available_range:range(0,frameCount,fps),target_url_base:'picture/',name_prefix:'frame-',name_suffix:'.png',
      start_frame:0,frame_step:1,rate:fps,frame_zero_padding:6,missing_frame_policy:'error'
    };
    video=[track('Picture','Video',shots.map(row=>clip(row.label,reference,row.offsetFrame,row.frames,fps,
      {firstFrame:row.firstFrame,shot:row.id})))];
  }
  return {OTIO_SCHEMA:'Timeline.1',name:title,metadata:{ink:{timeReference,sampleRate,
    ...(picture&&{frameRate:picture.frameRate,firstFrame:picture.fromFrame})}},
    global_start_time:picture ? rt(picture.fromFrame,picture.fps) :
      Number.isSafeInteger(origin) ? rt(origin) : null,
    tracks:{...item(picture ? 'Picture and stems' : 'Premaster stems'),OTIO_SCHEMA:'Stack.1',
      markers:cues.map(cue=>({OTIO_SCHEMA:'Marker.2',name:cue.label,color:cue.kind==='authored' ? 'CYAN' : 'WHITE',
        comment:cue.role ?? '',metadata:{ink:cue},marked_range:range(cue.offsetSample,cue.durationSamples)})),
      children:[...video,...audio,...isolated]
    }
  };
}
const headings=['id','label','role','kind','source','fromSample','toSample','offsetSample','durationSamples',
  'pictureFrame','timeReference'];
function cueCSV(cues) {
  const cell=value=>{
    if (value==null) return '';
    if (typeof value==='number') return String(value);
    const string=String(value);
    const safe=/^\s*[=+\-@]/.test(string) ? "'"+string : string;
    return '"'+safe.replaceAll('"','""')+'"';
  };
  return [headings.join(','),...cues.map(row=>headings.map(key=>cell(row[key])).join(','))].join('\r\n')+'\r\n';
}
module.exports={editorialTimeline,cueCSV};
