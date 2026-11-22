/* Split Reed instrument shared by the sound discovery and phrase performance demos. */
module.exports={type:'graph',output:'out',tail:.44,nodes:{
  register:{type:'curve',points:[[0,.968],[.29,.968],[.36,1.4663],[.63,1.4663],[.71,1.15721],[1,1.15721]],clock:'gate'},
  rasp:{type:'oscillator',wave:'sine',ratio:{base:.06448,from:{register:2.015}}},
  color:{type:'oscillator',wave:'sine',ratio:{base:.032,from:{register:1}},phaseInput:'rasp',
    index:{base:.026,by:{pressure:.075}}},
  air:{type:'noise'}, throat:{type:'filter',input:'air',mode:'bandpass',cutoff:{base:990,by:{pressure:1380,breath:1700}},resonance:1.75},
  hiss:{type:'gain',input:'throat',amount:{base:.018,by:{breath:.14,damping:.072}}},
  sum:{type:'mix',inputs:['color','hiss']},env:{type:'envelope',env:{attack:.047,decay:.28,sustain:.76,release:.36}},
  out:{type:'gain',input:'sum',amount:{base:0,from:{env:.76}}}
},controls:{pressure:.57,breath:.31,damping:.18},
articulations:{steady:{nodes:{rasp:{ratio:2.015},color:{ratio:1}}}}};
