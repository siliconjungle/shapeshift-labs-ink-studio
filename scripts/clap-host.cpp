// Offline CLAP worker. Build against the upstream CLAP SDK headers.
#include <clap/clap.h>
#include <clap/ext/preset-load.h>
#include <clap/factory/preset-discovery.h>
#include <dlfcn.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstring>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
void need(bool ok, const char *message) { if (!ok) throw std::runtime_error(message); }
constexpr uint32_t magic = 0x314b4e49, instrumentMagic = 0x324b4e49, blockSize = 256, stateLimit = 4*1024*1024, maxFrames = 8000000;
constexpr uint32_t maxOutputs = 16;
thread_local bool audioThread = false;

template <class T> T read(std::ifstream &file) {
  T value{};
  need(bool(file.read(reinterpret_cast<char *>(&value), sizeof value)), "Truncated CLAP job");
  return value;
}
template <class T> std::vector<T> readMany(std::ifstream &file, size_t count) {
  std::vector<T> result(count);
  if (count) need(bool(file.read(reinterpret_cast<char *>(result.data()), count*sizeof(T))), "Truncated CLAP job buffer");
  return result;
}
struct Knot { int32_t at; double value; };
struct Lane {
  clap_id id = 0;
  bool linear = false;
  std::vector<Knot> points;
  size_t cursor = 0;
  double last = std::numeric_limits<double>::quiet_NaN();
  double at(int64_t sample) {
    while (cursor+1<points.size() && points[cursor+1].at<=sample) ++cursor;
    const auto &left=points[cursor];
    if (!linear || sample<=left.at || cursor+1==points.size()) return left.value;
    const auto &right=points[cursor+1];
    return left.value+(right.value-left.value)*(sample-left.at)/(right.at-left.at);
  }
};
enum NoteType { On=-3, Off=-2, Choke=-1 };
struct Note {
  uint32_t at;
  int32_t id;
  int16_t key, type;
  double value;
};
struct Tempo {uint32_t at;double beat,bpm;};
struct Job {
  uint32_t rate, frames, latency, tail;
  bool instrument;
  uint32_t meter=4;
  std::vector<Tempo> changes;
  std::vector<Lane> lanes;
  std::vector<Note> notes;
  std::vector<char> state;
  std::vector<float> input,key;
  explicit Job(const char *name) {
    std::ifstream file(name,std::ios::binary);
    const auto version=read<uint32_t>(file);
    need(version==magic || version==instrumentMagic,"Unknown CLAP job format");
    instrument=version==instrumentMagic;
    rate=read<uint32_t>(file); frames=read<uint32_t>(file);
    const auto inputFrames=read<uint32_t>(file), keyFrames=read<uint32_t>(file), stateBytes=read<uint32_t>(file),
      controls=read<uint32_t>(file);
    latency=read<uint32_t>(file); tail=read<uint32_t>(file);
    const auto events=instrument ? read<uint32_t>(file) : 0;
    if (instrument) meter=read<uint32_t>(file);
    const auto tempos=instrument ? read<uint32_t>(file) : 0;
    need(meter>=1 && meter<=32 && tempos<=513,"Invalid CLAP time signature or tempo budget");
    need(events<=2000000 && (!instrument || (!inputFrames && !keyFrames)),"Invalid CLAP note or input budget");
    need(rate>=8000 && rate<=96000 && frames<=maxFrames && inputFrames<=maxFrames &&
      keyFrames<=maxFrames && stateBytes<=stateLimit && controls<=64,"CLAP job exceeds host bounds");
    for (uint32_t i=0;i<controls;i++) {
      Lane lane;
      lane.id=read<uint32_t>(file);
      lane.linear=read<uint32_t>(file)!=0;
      const auto knots=read<uint32_t>(file);
      need(knots>0 && knots<=2048,"Invalid CLAP parameter lane");
      for (uint32_t n=0;n<knots;n++) {
        const auto at=read<int32_t>(file);
        const auto value=read<double>(file);
        need(std::isfinite(value) && (!n || lane.points.back().at<at),"Invalid CLAP parameter point");
        lane.points.push_back({at,value});
      }
      lanes.push_back(std::move(lane));
    }
    notes.reserve(events);
    for (uint32_t i=0;i<events;i++) {
      const auto at=read<uint32_t>(file);
      const auto id=read<int32_t>(file);
      const auto key=read<int16_t>(file), type=read<int16_t>(file);
      read<uint32_t>(file); // reserved
      const auto value=read<double>(file);
      const double minimum=type==CLAP_NOTE_EXPRESSION_TUNING ? -120 : 0;
      const double maximum=type==CLAP_NOTE_EXPRESSION_TUNING ? 120 : type==CLAP_NOTE_EXPRESSION_VOLUME ? 4 : 1;
      need(at<frames && id>=0 && key>=0 && key<=127 && type>=On && type<=CLAP_NOTE_EXPRESSION_PRESSURE &&
        value>=minimum && value<=maximum && (i==0 || notes.back().at<=at),"Invalid CLAP note event");
      notes.push_back({at,id,key,type,value});
    }
    for (uint32_t i=0;i<tempos;i++) {
      const auto at=read<uint32_t>(file);
      const auto beat=read<double>(file), bpm=read<double>(file);
      need(at<frames && (i ? at>changes.back().at : at==0) && std::abs(beat)<=1e9 && bpm>=1 && bpm<=1000,
        "Invalid CLAP transport segment");
      changes.push_back({at,beat,bpm});
    }
    state=readMany<char>(file,stateBytes);
    input=readMany<float>(file,2*size_t(inputFrames));
    key=readMany<float>(file,2*size_t(keyFrames));
    need(file.peek()==std::ifstream::traits_type::eof(),"Unexpected bytes after CLAP job");
  }
};
struct Events {
  union Event {
    clap_event_header_t header;
    clap_event_param_value_t param;
    clap_event_note_t note;
    clap_event_note_expression_t expression;
    clap_event_midi_t midi;
  };
  std::vector<Event> values;
  clap_input_events_t in{this,
    [](const clap_input_events_t *list) {return uint32_t(static_cast<Events *>(list->ctx)->values.size());},
    [](const clap_input_events_t *list, uint32_t index)->const clap_event_header_t * {
      const auto &values=static_cast<Events *>(list->ctx)->values;
      return index<values.size() ? &values[index].header : nullptr;
    }};
  clap_output_events_t out{nullptr,[](const clap_output_events_t *,const clap_event_header_t *) {return true;}};
  void push(uint32_t i,const clap_param_info_t &param,double value) {
    Event event{};
    event.param={{sizeof(clap_event_param_value_t),i,CLAP_CORE_EVENT_SPACE_ID,CLAP_EVENT_PARAM_VALUE,0},
      param.id,param.cookie,-1,-1,-1,-1,value};
    values.push_back(event);
  }
  void push(uint32_t i,const Note &note,uint16_t port,uint32_t dialect) {
    Event event{};
    if (dialect==CLAP_NOTE_DIALECT_MIDI) {
      need(note.type<0,"MIDI-only CLAP instrument cannot receive native note expression");
      const auto status=uint8_t(note.type==On ? 0x90 : 0x80);
      const auto vel=note.type==On ? std::max(1l,std::lround(note.value*127)) : std::lround(note.value*127);
      event.midi={{sizeof(clap_event_midi_t),i,CLAP_CORE_EVENT_SPACE_ID,CLAP_EVENT_MIDI,0},port,
        {status,uint8_t(note.key),uint8_t(vel)}};
    } else if (note.type<0) {
      const auto type=uint16_t(note.type==On ? CLAP_EVENT_NOTE_ON : note.type==Off ? CLAP_EVENT_NOTE_OFF : CLAP_EVENT_NOTE_CHOKE);
      event.note={{sizeof(clap_event_note_t),i,CLAP_CORE_EVENT_SPACE_ID,type,0},note.id,int16_t(port),0,note.key,note.value};
    } else {
      event.expression={{sizeof(clap_event_note_expression_t),i,CLAP_CORE_EVENT_SPACE_ID,CLAP_EVENT_NOTE_EXPRESSION,0},
        note.type,note.id,int16_t(port),0,note.key,note.value};
    }
    values.push_back(event);
  }
};
struct Host {
  std::atomic<bool> restart{false},callback{false};
  clap_host_t host{CLAP_VERSION,this,"Ink Offline","Shapeshift Labs","","1",
    [](const clap_host_t *,const char *ext)->const void * {
      static const clap_host_thread_check_t thread{
        [](const clap_host_t *) {return !audioThread;},[](const clap_host_t *) {return audioThread;}
      };
      static const clap_host_note_ports_t notes{
        [](const clap_host_t *) {return uint32_t(CLAP_NOTE_DIALECT_CLAP|CLAP_NOTE_DIALECT_MIDI);},
        [](const clap_host_t *,uint32_t) {}
      };
      if (!std::strcmp(ext,CLAP_EXT_NOTE_PORTS)) return &notes;
      static const clap_host_latency_t latency{[](const clap_host_t *) {}};
      static const clap_host_params_t params{
        [](const clap_host_t *,clap_param_rescan_flags) {},
        [](const clap_host_t *,clap_id,clap_param_clear_flags) {},
        [](const clap_host_t *) {}
      };
      static const clap_host_tail_t tail{[](const clap_host_t *) {}};
      static const clap_host_preset_load_t preset{
        [](const clap_host_t *,uint32_t,const char *,const char *,int32_t,const char *) {},
        [](const clap_host_t *,uint32_t,const char *,const char *) {}
      };
      if (!std::strcmp(ext,CLAP_EXT_PRESET_LOAD) || !std::strcmp(ext,CLAP_EXT_PRESET_LOAD_COMPAT)) return &preset;
      if (!std::strcmp(ext,CLAP_EXT_THREAD_CHECK)) return &thread;
      if (!std::strcmp(ext,CLAP_EXT_LATENCY)) return &latency;
      if (!std::strcmp(ext,CLAP_EXT_PARAMS)) return &params;
      if (!std::strcmp(ext,CLAP_EXT_TAIL)) return &tail;
      return nullptr;
    },
    [](const clap_host_t *h) {static_cast<Host *>(h->host_data)->restart=true;},
    [](const clap_host_t *) {},
    [](const clap_host_t *h) {static_cast<Host *>(h->host_data)->callback=true;}};
};
struct Instance {
  Host host;
  void *module=nullptr;
  const clap_plugin_entry_t *entry=nullptr;
  const clap_plugin_t *plugin=nullptr;
  bool entryReady=false,active=false,processing=false;
  ~Instance() {
    if (processing) {audioThread=true;plugin->stop_processing(plugin);audioThread=false;}
    if (active) plugin->deactivate(plugin);
    if (plugin) plugin->destroy(plugin);
    if (entryReady) entry->deinit();
    if (module) dlclose(module);
  }
  template<class T> const T *extension(const char *id) const {
    return static_cast<const T *>(plugin->get_extension(plugin,id));
  }
  void open(const char *binary,const char *entryPath,const char *id) {
    module=dlopen(binary,RTLD_LOCAL|RTLD_NOW);
    if (!module) throw std::runtime_error(dlerror());
    entry=static_cast<const clap_plugin_entry_t *>(dlsym(module,"clap_entry"));
    need(entry && clap_version_is_compatible(entry->clap_version),"Incompatible CLAP entry");
    entryReady=entry->init(entryPath);
    need(entryReady,"CLAP entry initialization failed");
    const auto *factory=static_cast<const clap_plugin_factory_t *>(entry->get_factory(CLAP_PLUGIN_FACTORY_ID));
    need(factory,"Missing CLAP plugin factory");
    plugin=factory->create_plugin(factory,&host.host,id);
    need(plugin && plugin->init(plugin),"CLAP plugin ID or initialization failed");
  }
  void start(uint32_t rate) {
    if (const auto *render=extension<clap_plugin_render_t>(CLAP_EXT_RENDER)) {
      need(!render->has_hard_realtime_requirement(plugin) && render->set(plugin,CLAP_RENDER_OFFLINE),
        "Plugin does not support offline processing");
    }
    active=plugin->activate(plugin,rate,1,blockSize);
    need(active,"CLAP activation failed");
    host.restart=false;
  }
  void callback() {
    if (host.callback.exchange(false)) plugin->on_main_thread(plugin);
  }
};

bool loadState(Instance &instance,const std::vector<char> &bytes) {
  const auto *ext=instance.extension<clap_plugin_state_t>(CLAP_EXT_STATE);
  if (bytes.empty()) return true;
  if (!ext) return false;
  struct Cursor {const std::vector<char> &data;size_t at=0;} cursor{bytes};
  const clap_istream_t stream{&cursor,[](const clap_istream_t *s,void *target,uint64_t size)->int64_t {
    auto &c=*static_cast<Cursor *>(s->ctx);
    const auto count=std::min<uint64_t>(size,c.data.size()-c.at);
    if (count) std::memcpy(target,c.data.data()+c.at,count);
    c.at+=count;
    return count;
  }};
  return ext->load(instance.plugin,&stream);
}
void loadPreset(Instance &instance,const char *file) {
  auto *ext=instance.extension<clap_plugin_preset_load_t>(CLAP_EXT_PRESET_LOAD);
  if (!ext) ext=instance.extension<clap_plugin_preset_load_t>(CLAP_EXT_PRESET_LOAD_COMPAT);
  need(ext,"CLAP plugin does not expose preset loading");
  need(ext->from_location(instance.plugin,CLAP_PRESET_DISCOVERY_LOCATION_FILE,file,nullptr),
    "CLAP preset could not be loaded");
  instance.callback();
}
void saveState(Instance &instance,const char *file) {
  const auto *ext=instance.extension<clap_plugin_state_t>(CLAP_EXT_STATE);
  need(ext,"CLAP plugin does not expose state");
  std::vector<char> bytes;
  const clap_ostream_t stream{&bytes,[](const clap_ostream_t *s,const void *data,uint64_t size)->int64_t {
    auto &out=*static_cast<std::vector<char> *>(s->ctx);
    if (size>stateLimit-out.size()) return -1;
    if (size) {const auto *first=static_cast<const char *>(data);out.insert(out.end(),first,first+size);}
    return size;
  }};
  need(ext->save(instance.plugin,&stream),"CLAP state save failed");
  std::ofstream out(file,std::ios::binary);
  if (!bytes.empty()) out.write(bytes.data(),bytes.size());
  need(bool(out),"Cannot write CLAP state");
}
using Catalog=std::map<clap_id,clap_param_info_t>;
Catalog parameters(Instance &instance,Job &job,Events &events) {
  Catalog rows;
  const auto *ext=instance.extension<clap_plugin_params_t>(CLAP_EXT_PARAMS);
  if (ext) {
    const auto count=ext->count(instance.plugin);
    need(count<=8192,"CLAP parameter count exceeds the host budget");
    for (uint32_t i=0;i<count;i++) {
      clap_param_info_t info{};
      need(ext->get_info(instance.plugin,i,&info),"Cannot read CLAP parameter");
      if (!(info.flags&CLAP_PARAM_IS_READONLY)) rows.emplace(info.id,info);
    }
  }
  for (auto &lane:job.lanes) {
    need(rows.count(lane.id),"Unknown or read-only CLAP parameter");
    const auto &param=rows.at(lane.id);
    const bool stepped=param.flags&CLAP_PARAM_IS_STEPPED;
    need(lane.points.size()==1 || (param.flags&CLAP_PARAM_IS_AUTOMATABLE),"CLAP parameter does not accept automation");
    for (const auto &point:lane.points) need(point.value>=param.min_value && point.value<=param.max_value &&
      (!stepped || (!lane.linear && std::trunc(point.value)==point.value)),"CLAP parameter is outside its range");
    lane.last=lane.at(0);
    events.push(0,param,lane.last);
  }
  if (!job.lanes.empty()) ext->flush(instance.plugin,&events.in,&events.out);
  events.values.clear();
  instance.callback();
  return rows;
}
struct Ports {
  uint32_t input=0,inputChannels=2,key=0,dialect=0,outputs=0;
  uint16_t note=0;
  std::array<uint32_t,maxOutputs> channels{};
};
Ports ports(Instance &instance,bool instrument) {
  const auto *ext=instance.extension<clap_plugin_audio_ports_t>(CLAP_EXT_AUDIO_PORTS);
  const auto *plugin=instance.plugin;
  clap_audio_port_info_t input{},output{},key{};
  Ports result;
  result.outputs=ext ? ext->count(plugin,false) : 0;
  need(result.outputs>=1 && result.outputs<=(instrument ? maxOutputs : 1),
    "Unsupported CLAP audio output count");
  for (uint32_t i=0;i<result.outputs;i++) {
    need(ext->get(plugin,i,false,&output) && (output.channel_count==1 || output.channel_count==2),
      "CLAP audio outputs must be mono or stereo");
    if (result.outputs>1) need(bool(output.flags&CLAP_AUDIO_PORT_IS_MAIN)==(i==0),
      "A multi-output CLAP instrument needs a declared main output at index zero");
    result.channels[i]=output.channel_count;
  }
  const auto count=ext->count(plugin,true);
  if (instrument) {
    need(count<=1 && (!count || (ext->get(plugin,0,true,&input) &&
      (input.channel_count==1 || input.channel_count==2))),
      "CLAP instrument can have at most one mono or stereo audio input");
    result.input=count;
    if (count) result.inputChannels=input.channel_count;
    const auto *notes=instance.extension<clap_plugin_note_ports_t>(CLAP_EXT_NOTE_PORTS);
    need(notes,"CLAP instrument needs a note input");
    const auto n=notes->count(plugin,true);
    need(n && n<=128,"Invalid CLAP note port count");
    for (uint32_t i=0;i<n;i++) {
      clap_note_port_info_t info{};
      need(notes->get(plugin,i,true,&info),"Cannot read CLAP note port");
      if (info.supported_dialects&CLAP_NOTE_DIALECT_CLAP) {
        result.dialect=CLAP_NOTE_DIALECT_CLAP;
        result.note=uint16_t(i);
        break;
      }
      if (!result.dialect && (info.supported_dialects&CLAP_NOTE_DIALECT_MIDI)) {
        result.dialect=CLAP_NOTE_DIALECT_MIDI;
        result.note=uint16_t(i);
      }
    }
    need(result.dialect,"No supported CLAP or MIDI note dialect");
  } else {
    need((count==1 || count==2) && ext->get(plugin,0,true,&input) &&
      input.channel_count==2 && result.channels[0]==2,"Host requires stereo main input and output");
    result.input=count;
    if (count==2) {
      need(ext->get(plugin,1,true,&key) && (key.channel_count==1 || key.channel_count==2),
        "A CLAP key port needs mono or stereo input");
      result.key=key.channel_count;
    }
  }
  return result;
}

void render(Instance &instance,Job &job,Events &events,const Catalog &params,const Ports &ports,const char *file) {
  std::ofstream out(file,std::ios::binary);
  need(bool(out) && (job.key.empty() || ports.key),"Invalid CLAP output or sidechain");
  using Block=std::array<std::array<float,blockSize>,2>;
  Block main{},side{};
  std::array<Block,maxOutputs> output{};
  std::array<std::array<float *,2>,maxOutputs> channels{};
  std::array<clap_audio_buffer_t,maxOutputs> buffers{};
  for (uint32_t i=0;i<ports.outputs;i++) {
    channels[i]={output[i][0].data(),output[i][1].data()};
    buffers[i]={channels[i].data(),nullptr,ports.channels[i],0,0};
  }
  float *pMain[]={main[0].data(),main[1].data()}, *pSide[]={side[0].data(),side[1].data()};
  const clap_audio_buffer_t inputs[2]={{pMain,nullptr,ports.inputChannels,0,0},{pSide,nullptr,ports.key,0,0}};
  const auto frames=uint64_t(job.frames)+job.latency;
  audioThread=true;
  instance.processing=instance.plugin->start_processing(instance.plugin);
  audioThread=false;
  need(instance.processing,"CLAP start processing failed");
  std::vector<float> interleaved;
  interleaved.reserve(blockSize*2);
  size_t eventIndex=0, tempoIndex=0;
  for (uint64_t base=0;base<frames;) {
    if (tempoIndex+1<job.changes.size() && job.changes[tempoIndex+1].at==base) ++tempoIndex;
    const auto next=tempoIndex+1<job.changes.size() ? job.changes[tempoIndex+1].at : frames;
    const auto count=uint32_t(std::min({uint64_t(blockSize),frames-base,next-base}));
    clap_event_transport_t transport{};
    if (!job.changes.empty()) {
      const auto &tempo=job.changes[tempoIndex];
      const auto beat=tempo.beat+double(base-tempo.at)*tempo.bpm/(60*job.rate);
      const auto bar=std::floor(beat/job.meter);
      transport.header={sizeof(transport),0,CLAP_CORE_EVENT_SPACE_ID,CLAP_EVENT_TRANSPORT,0};
      transport.flags=CLAP_TRANSPORT_HAS_TEMPO|CLAP_TRANSPORT_HAS_BEATS_TIMELINE|
        CLAP_TRANSPORT_HAS_SECONDS_TIMELINE|CLAP_TRANSPORT_HAS_TIME_SIGNATURE|CLAP_TRANSPORT_IS_PLAYING;
      transport.song_pos_beats=std::llround(beat*CLAP_BEATTIME_FACTOR);
      transport.song_pos_seconds=std::llround(double(base)*CLAP_SECTIME_FACTOR/job.rate);
      transport.tempo=tempo.bpm;
      transport.bar_number=int32_t(bar);
      transport.bar_start=std::llround(bar*job.meter*CLAP_BEATTIME_FACTOR);
      transport.tsig_num=uint16_t(job.meter);
      transport.tsig_denom=4;
    }
    events.values.clear();
    for (uint32_t i=0;i<count;i++) {
      const auto sample=base+i, offset=sample*2;
      for (size_t ch=0;ch<2;ch++) {
        main[ch][i]=offset+ch<job.input.size() ? job.input[offset+ch] : 0;
        side[ch][i]=offset+ch<job.key.size() ? job.key[offset+ch] : 0;
      }
      if (ports.key==1) side[0][i]=(side[0][i]+side[1][i])*.5f;
      for (auto &lane:job.lanes) if (lane.points.size()>1) {
        const auto value=lane.at(sample);
        if (lane.last!=value) {events.push(i,params.at(lane.id),value);lane.last=value;}
      }
      while (eventIndex<job.notes.size() && job.notes[eventIndex].at==sample)
        events.push(i,job.notes[eventIndex++],ports.note,ports.dialect);
    }
    for (uint32_t i=0;i<ports.outputs;i++) {
      for (uint32_t ch=0;ch<ports.channels[i];ch++) std::fill_n(output[i][ch].begin(),count,0);
      buffers[i].constant_mask=0;
    }
    const clap_process_t process{int64_t(base),count,job.changes.empty() ? nullptr : &transport,
      ports.input ? inputs : nullptr,buffers.data(),ports.input,ports.outputs,&events.in,&events.out};
    audioThread=true;
    const auto status=instance.plugin->process(instance.plugin,&process);
    audioThread=false;
    instance.callback();
    need(status>=CLAP_PROCESS_CONTINUE && status<=CLAP_PROCESS_SLEEP && !instance.host.restart,
      "CLAP process failed or requested a layout restart");
    interleaved.clear();
    for (uint32_t i=0;i<count;i++) if (base+i>=job.latency) {
      for (size_t ch=0;ch<2;ch++) {
        const auto channel=ports.channels[0]==1 ? 0 : ch;
        const float value=output[0][channel][buffers[0].constant_mask&(1u<<channel) ? 0 : i];
        need(std::isfinite(value),"Nonfinite CLAP output");
        interleaved.push_back(value);
      }
    }
    if (!interleaved.empty()) out.write(reinterpret_cast<const char *>(interleaved.data()),interleaved.size()*sizeof(float));
    need(bool(out),"Cannot write CLAP PCM");
    base+=count;
  }
}
} // namespace

int main(int argc,char **argv) {
  try {
    need(argc==8 || argc==9,"Use worker mode binary entry-path plugin-id job output metadata [preset]");
    const std::string mode=argv[1];
    need(mode=="probe" || mode=="snapshot" || mode=="render","Invalid CLAP worker mode");
    Job job(argv[5]);
    Instance instance;
    instance.open(argv[2],argv[3],argv[4]);
    if (argc==9) {
      need(mode=="snapshot" && job.state.empty(),"A CLAP preset can only initialize a new snapshot");
      loadPreset(instance,argv[8]);
    } else need(loadState(instance,job.state),"CLAP state could not be restored");
    Events events;
    const auto params=parameters(instance,job,events);
    const auto layout=ports(instance,job.instrument);
    if (mode=="snapshot") {saveState(instance,argv[6]);return 0;}
    instance.start(job.rate);
    instance.callback();
    const auto *delay=instance.extension<clap_plugin_latency_t>(CLAP_EXT_LATENCY);
    const auto *decay=instance.extension<clap_plugin_tail_t>(CLAP_EXT_TAIL);
    const auto latency=delay ? delay->get(instance.plugin) : 0, tail=decay ? decay->get(instance.plugin) : 0;
    need(latency<=job.rate*2 && tail<=job.rate*60,"CLAP declares unsupported latency or tail");
    if (mode=="render") {
      need(job.latency==latency && job.tail==tail,"CLAP render contract changed since planning");
      render(instance,job,events,params,layout,argv[6]);
      audioThread=true;instance.plugin->stop_processing(instance.plugin);audioThread=false;
      instance.processing=false;
      need(!decay || decay->get(instance.plugin)==tail,"CLAP tail changed during the render");
    } else {
      std::ofstream report(argv[7]);
      report << latency << ' ' << tail << ' ' << layout.key << ' ' << layout.dialect << '\n' << std::setprecision(17);
      for (const auto &[id,param]:params) report << id << ' ' << param.min_value << ' ' << param.max_value << ' '
        << bool(param.flags&CLAP_PARAM_IS_AUTOMATABLE) << ' ' << bool(param.flags&CLAP_PARAM_IS_STEPPED) << '\n';
      need(bool(report),"Cannot write CLAP metadata");
    }
    return 0;
  } catch (const std::exception &error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
