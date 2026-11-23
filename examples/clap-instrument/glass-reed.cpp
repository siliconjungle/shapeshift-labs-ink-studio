// An offline-capable polyphonic CLAP instrument for the handoff example.
#include <clap/clap.h>
#include <clap/ext/preset-load.h>
#include <clap/factory/preset-discovery.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <fstream>

namespace {
constexpr double tau=6.283185307179586;
constexpr uint32_t latency=11;
constexpr clap_id tone=17;
const char *features[]={CLAP_PLUGIN_FEATURE_INSTRUMENT,CLAP_PLUGIN_FEATURE_SYNTHESIZER,CLAP_PLUGIN_FEATURE_STEREO,nullptr};
const clap_plugin_descriptor_t description{
  CLAP_VERSION,"org.ink.glass-reed","Glass Reed","Ink","","","","1","Expressive additive reed",features};

struct Voice {
  int32_t id=-1;
  int16_t key=0;
  double velocity=0,phase=0,age=0,release=0,tuning=0,volume=1;
  double pressure=.35,brightness=.45,expression=1,vibrato=0,pan=.5;
  bool held=false;
};

struct Reed {
  double rate=48000,color=.46;
  bool midiOnly=false,auxiliary=false;
  uint32_t history=0;
  std::array<Voice,32> voices{};
  std::array<std::array<float,latency>,2> line{};
  static Reed &get(const clap_plugin_t *p) {return *static_cast<Reed *>(p->plugin_data);}
  void on(int32_t id,int16_t key,double velocity) {
    const auto at=std::find_if(voices.begin(),voices.end(),[](const Voice &v){return v.id<0;});
    auto &voice=at==voices.end() ? voices.front() : *at;
    voice={};
    voice.id=id;voice.key=key;voice.velocity=velocity;voice.held=true;
    voice.pan=.5+.24*std::sin(key*.924);
  }
  void off(int32_t id,bool choke) {
    for (auto &v:voices) if (v.id==id) {
      if (choke) v.id=-1;
      else v.held=false;
    }
  }
  void event(const clap_event_header_t *item) {
    if (item->space_id!=CLAP_CORE_EVENT_SPACE_ID) return;
    switch(item->type) {
      case CLAP_EVENT_NOTE_ON:
      case CLAP_EVENT_NOTE_OFF:
      case CLAP_EVENT_NOTE_CHOKE: {
        const auto &e=*reinterpret_cast<const clap_event_note_t *>(item);
        if (item->type==CLAP_EVENT_NOTE_ON) on(e.note_id<0 ? e.key : e.note_id,e.key,e.velocity);
        else off(e.note_id<0 ? e.key : e.note_id,item->type==CLAP_EVENT_NOTE_CHOKE);
        break;
      }
      case CLAP_EVENT_MIDI: {
        const auto &e=*reinterpret_cast<const clap_event_midi_t *>(item);
        if ((e.data[0]&0xf0)==0x90 && e.data[2]) on(e.data[1],e.data[1],e.data[2]/127.0);
        else if ((e.data[0]&0xe0)==0x80) off(e.data[1],false);
        break;
      }
      case CLAP_EVENT_NOTE_EXPRESSION: {
        const auto &e=*reinterpret_cast<const clap_event_note_expression_t *>(item);
        for (auto &v:voices) if (v.id==e.note_id) switch(e.expression_id) {
          case CLAP_NOTE_EXPRESSION_VOLUME: v.volume=e.value;break;
          case CLAP_NOTE_EXPRESSION_PAN: v.pan=e.value;break;
          case CLAP_NOTE_EXPRESSION_TUNING: v.tuning=e.value;break;
          case CLAP_NOTE_EXPRESSION_PRESSURE: v.pressure=e.value;break;
          case CLAP_NOTE_EXPRESSION_BRIGHTNESS: v.brightness=e.value;break;
          case CLAP_NOTE_EXPRESSION_EXPRESSION: v.expression=e.value;break;
          case CLAP_NOTE_EXPRESSION_VIBRATO: v.vibrato=e.value;break;
        }
        break;
      }
      case CLAP_EVENT_PARAM_VALUE: {
        const auto &e=*reinterpret_cast<const clap_event_param_value_t *>(item);
        if (e.param_id==tone) color=e.value;
        break;
      }
    }
  }
  clap_process_status process(const clap_process_t &job) {
    if (auxiliary) {
      if (job.audio_inputs_count!=1 || job.audio_outputs_count!=2 ||
          job.audio_inputs[0].channel_count!=2 || job.audio_outputs[1].channel_count!=1)
        return CLAP_PROCESS_ERROR;
      for (uint32_t ch=0;ch<2;ch++)
        for (uint32_t i=0;i<job.frames_count;i++) if (job.audio_inputs[0].data32[ch][i]!=0)
          return CLAP_PROCESS_ERROR;
      std::fill_n(job.audio_outputs[1].data32[0],job.frames_count,0.75f);
    }
    uint32_t index=0;
    for (uint32_t i=0;i<job.frames_count;i++) {
      while (index<job.in_events->size(job.in_events)) {
        const auto *e=job.in_events->get(job.in_events,index);
        if (e->time>i) break;
        event(e);index++;
      }
      const double tempo=job.transport ? job.transport->tempo : 120;
      const double beat=job.transport ? double(job.transport->song_pos_beats)/CLAP_BEATTIME_FACTOR+i*tempo/(60*rate) : 0;
      double sum[2]={};
      for (auto &v:voices) if (v.id>=0) {
        v.age+=1/rate;
        if (!v.held) v.release+=1/rate;
        if (v.release>=.315) {v.id=-1;continue;}
        const double semitones=v.tuning+.46*v.vibrato*std::sin(tau*5.9*v.age);
        const double frequency=440*std::pow(2.0,(v.key-69+semitones)/12);
        v.phase+=std::min(frequency/rate,.49);
        v.phase-=std::floor(v.phase);
        const double a=tau*v.phase, touch=.22+.78*v.pressure;
        const double strength=std::min(1.0,v.age/.019)*std::exp(-14*v.release)*std::min(1.0,(.315-v.release)*105);
        const double shimmer=.92+.08*std::sin(tau*(beat*.5+v.key*.119));
        const double edge=(.22+.6*color)*(.29+.71*v.brightness)*touch;
        const double body=std::sin(a+.17*std::sin(2*a))+.31*std::sin(2*a)+edge*(.53*std::sin(3*a)+.31*std::sin(5*a));
        const double chime=.13*std::sin(7*a)*std::exp(-17*v.age);
        const double signal=(body+chime)*v.velocity*strength*touch*shimmer*v.expression*v.volume*.23;
        sum[0]+=signal*std::sqrt(1-v.pan);
        sum[1]+=signal*std::sqrt(v.pan);
      }
      for (uint32_t channel=0;channel<2;channel++) {
        job.audio_outputs[0].data32[channel][i]=line[channel][history];
        line[channel][history]=float(sum[channel]);
      }
      if (++history==latency) history=0;
    }
    return CLAP_PROCESS_CONTINUE;
  }
  clap_plugin_t plugin{&description,this,
    [](const clap_plugin_t *) {return true;},[](const clap_plugin_t *p) {delete &get(p);},
    [](const clap_plugin_t *p,double rate,uint32_t,uint32_t) {get(p).rate=rate;return true;},
    [](const clap_plugin_t *) {},[](const clap_plugin_t *) {return true;},[](const clap_plugin_t *) {},
    [](const clap_plugin_t *p) {auto &self=get(p);self.voices={};self.line={};self.history=0;},
    [](const clap_plugin_t *p,const clap_process_t *job){return get(p).process(*job);},
    [](const clap_plugin_t *,const char *extension)->const void * {
      static const clap_plugin_audio_ports_t audio{
        [](const clap_plugin_t *p,bool input)->uint32_t {
          return input ? uint32_t(get(p).auxiliary) : 1+uint32_t(get(p).auxiliary);
        },
        [](const clap_plugin_t *p,uint32_t index,bool input,clap_audio_port_info_t *info) {
          if ((input && (!get(p).auxiliary || index)) || (!input && index>uint32_t(get(p).auxiliary))) return false;
          *info={};info->id=index;info->channel_count=index ? 1 : 2;
          info->flags=index ? 0 : CLAP_AUDIO_PORT_IS_MAIN;info->port_type=index ? CLAP_PORT_MONO : CLAP_PORT_STEREO;
          info->in_place_pair=CLAP_INVALID_ID;std::strcpy(info->name,index ? "Aux" : "Main");return true;
        }
      };
      static const clap_plugin_note_ports_t notes{
        [](const clap_plugin_t *,bool input)->uint32_t {return input ? 1 : 0;},
        [](const clap_plugin_t *p,uint32_t index,bool input,clap_note_port_info_t *info) {
          if (index || !input) return false;
          *info={};info->supported_dialects=get(p).midiOnly ? CLAP_NOTE_DIALECT_MIDI : CLAP_NOTE_DIALECT_CLAP|CLAP_NOTE_DIALECT_MIDI;
          info->preferred_dialect=get(p).midiOnly ? CLAP_NOTE_DIALECT_MIDI : CLAP_NOTE_DIALECT_CLAP;
          std::strcpy(info->name,"Keyboard");return true;
        }
      };
      static const clap_plugin_latency_t delay{[](const clap_plugin_t *) {return latency;}};
      static const clap_plugin_tail_t decay{[](const clap_plugin_t *p) {return uint32_t(std::ceil(.315*get(p).rate));}};
      static const clap_plugin_params_t params{
        [](const clap_plugin_t *)->uint32_t {return 1;},
        [](const clap_plugin_t *,uint32_t index,clap_param_info_t *info) {
          if (index) return false;
          *info={};info->id=tone;info->flags=CLAP_PARAM_IS_AUTOMATABLE;info->max_value=1;info->default_value=.46;
          std::strcpy(info->name,"Reed color");return true;
        },
        [](const clap_plugin_t *p,clap_id id,double *value) {*value=get(p).color;return id==tone;},
        [](const clap_plugin_t *,clap_id,double,char *,uint32_t) {return false;},
        [](const clap_plugin_t *,clap_id,const char *,double *) {return false;},
        [](const clap_plugin_t *p,const clap_input_events_t *in,const clap_output_events_t *) {
          for (uint32_t i=0;i<in->size(in);i++) get(p).event(in->get(in,i));
        }
      };
      static const clap_plugin_state_t state{
        [](const clap_plugin_t *p,const clap_ostream_t *out) {
          return out->write(out,&get(p).color,sizeof(double))==sizeof(double);
        },
        [](const clap_plugin_t *p,const clap_istream_t *in) {
          return in->read(in,&get(p).color,sizeof(double))==sizeof(double);
        }
      };
      static const clap_plugin_preset_load_t preset{
        [](const clap_plugin_t *p,uint32_t kind,const char *file,const char *key) {
          if (kind!=CLAP_PRESET_DISCOVERY_LOCATION_FILE || !file || key) return false;
          double color;
          std::ifstream in(file);
          if (!(in >> color) || !(color>=0 && color<=1)) return false;
          get(p).color=color;return true;
        }
      };
      if (!std::strcmp(extension,CLAP_EXT_PRESET_LOAD)) return &preset;
      if (!std::strcmp(extension,CLAP_EXT_AUDIO_PORTS)) return &audio;
      if (!std::strcmp(extension,CLAP_EXT_NOTE_PORTS)) return &notes;
      if (!std::strcmp(extension,CLAP_EXT_LATENCY)) return &delay;
      if (!std::strcmp(extension,CLAP_EXT_TAIL)) return &decay;
      if (!std::strcmp(extension,CLAP_EXT_PARAMS)) return &params;
      if (!std::strcmp(extension,CLAP_EXT_STATE)) return &state;
      return nullptr;
    },
    [](const clap_plugin_t *) {}};
};
const clap_plugin_descriptor_t midiDescription{
  CLAP_VERSION,"org.ink.glass-reed-midi","Glass Reed MIDI","Ink","","","","1","MIDI note-port fixture",features};
const clap_plugin_descriptor_t auxDescription{
  CLAP_VERSION,"org.ink.glass-reed-aux","Glass Reed Aux","Ink","","","","1","Preset and aux-port fixture",features};
const std::array<const clap_plugin_descriptor_t *,3> descriptions{&description,&midiDescription,&auxDescription};
const clap_plugin_factory_t factory{
  [](const clap_plugin_factory_t *)->uint32_t{return descriptions.size();},
  [](const clap_plugin_factory_t *,uint32_t i)->const clap_plugin_descriptor_t * {
    return i<descriptions.size() ? descriptions[i] : nullptr;
  },
  [](const clap_plugin_factory_t *,const clap_host_t *,const char *id)->const clap_plugin_t * {
    const auto found=std::find_if(descriptions.begin(),descriptions.end(),[&](const auto *d){return !std::strcmp(id,d->id);});
    if (found==descriptions.end()) return nullptr;
    auto &reed=*new Reed;
    reed.midiOnly=*found==&midiDescription;
    reed.auxiliary=*found==&auxDescription;
    reed.plugin.desc=*found;
    return &reed.plugin;
  }};
} // namespace

extern "C" CLAP_EXPORT const clap_plugin_entry_t clap_entry{CLAP_VERSION,
  [](const char *){return true;},[](){},
  [](const char *id)->const void * {return std::strcmp(id,CLAP_PLUGIN_FACTORY_ID) ? nullptr : &factory;}};
