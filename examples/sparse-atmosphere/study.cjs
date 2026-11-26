/* One kiln plume and one rising cloud bank on large sparse lattices. */
const grid={origin:[-6,0,-6],spacing:[.16,.16,.16],size:[120,100,100]};
const base={grid,brickSize:4};
const plan=(id,mode,settings,reaction,sources,seed,run={})=>({
  format:'ink-studio/atmosphere-3d-plan',version:1,id,seed,config:{...base,mode,settings,reaction,sources},
  run:{dt:1/25,ticks:56,every:4,frames:[44],maxWork:460000000,...run,
    upRes:{factor:2,strength:.73,frequency:1.92,flow:.62,maxCells:120000}}
});
function studies(){
  const kiln=plan('beacon-kiln','combustion',
    {wind:[2.3,.05,.55],windGain:4,swirl:2.45,swirlScale:2.55,buoyancy:5.8,temperatureDecay:.72,densityDecay:.24,
      prune:.00045,maxActive:20000,pressureIterations:15,maxWork:6400000},
    {ignition:588,ignitionBand:85,burnRate:7.4,heatYield:820,smokeYield:.88},
    {fire:{at:[-.12,.41,-.04],radii:[.54,.32,.43],start:0,end:2.02,velocity:[-.10,2.45,0],
      rates:{fuel:6.4,heat:2940,density:.29}},
    draft:{at:[.17,.55,.19],radii:[.25,.25,.24],start:.18,end:1.53,velocity:[.50,1.75,.21],
      rates:{fuel:1.25,heat:720},velocityGain:6}},19,
    {commands:[{tick:37,action:'gain',args:{source:'fire',gain:.38}}]});
  const cloud=plan('cirrus-deck','cloud',
    {wind:[1.08,.13,.14],swirl:.62,swirlScale:1.65,buoyancy:7.3,temperatureDecay:.57,densityDecay:.05,
      prune:.00024,maxActive:24000,pressureIterations:15,maxWork:7400000},
    {saturation:.18,heightCooling:.64,temperatureSensitivity:.018,condensationRate:6.6,evaporationRate:1.35,latentHeat:13},
    {vapor:{at:[-.55,.88,.08],radii:[.65,.40,.52],start:0,end:1.82,velocity:[.37,1.75,.22],
      rates:{vapor:4.10,heat:73},velocityGain:9},
    bank:{at:[.34,1.03,-.14],radii:[.65,.44,.46],start:.13,end:2.06,velocity:[.20,1.32,-.07],
      rates:{vapor:3.5,heat:74},velocityGain:8}},31);
  return {kiln,cloud};
}
module.exports={studies};
