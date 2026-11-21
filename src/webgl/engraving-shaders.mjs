export const engravingVertexUniforms = `uniform int u_engravingRows,u_engravingSettings;
uniform vec3 u_engravingLight;
flat out vec4 v_engravingAnchor,v_engravingX,v_engravingY,v_engravingRestNormal;
vec4 engravingData(int texel){return texelFetch(u_data,ivec2(texel%2048,texel/2048),0);}
`;
export const engravingVertex = `
 int eq=u_engravingRows*2048+a_index*4;
 vec4 ea=engravingData(eq),eb=engravingData(eq+1),ec=engravingData(eq+2),ed=engravingData(eq+3);
 int slot=(kraw&(32|256|32768))!=0?0:int(ea.x);v_engravingAnchor=vec4(ea.yzw,float(slot));v_engravingX=vec4(0);v_engravingY=vec4(0);v_engravingRestNormal=vec4(0,1,0,fogk);
 if(slot>0){
  vec3 ru=eb.xyz,rv=ec.xyz,lu=vec3(eb.w,ec.w,ed.x),lv=ed.yzw;
  vec3 wu=FM*lu*sc,wv=FM*lv*sc;vec2 pu=(T*wu).xy,pv=(T*wv).xy;float area=pu.x*pv.y-pu.y*pv.x;
  if(abs(area)>1e-10&&length(cross(wu,wv))>1e-10){
   v_engravingX.xyz=(ru*pv.y-rv*pu.y)/area;v_engravingY.xyz=(-ru*pv.x+rv*pu.x)/area;vec3 weights=pow(abs(normalize(cross(ru,rv))),vec3(8));v_engravingRestNormal.xyz=weights/max(1e-8,weights.x+weights.y+weights.z);
   int at=u_engravingSettings*2048+(slot-1)*9;vec4 info=engravingData(at),settings=engravingData(at+1),paper=engravingData(at+3),axis=engravingData(at+5);
   float footprint=max(length(v_engravingX.xyz),length(v_engravingY.xyz));
   v_engravingX.w=clamp(log2(max(1e-8,footprint*info.y/settings.x))+axis.w,0.,3.);
   v_engravingY.w=1.-clamp(paper.w+(1.-paper.w)*max(0.,dot(normalize(cross(wu,wv)),normalize(u_engravingLight))),0.,1.);
  }else v_engravingAnchor.w=0.;
 }
`;
export const engravingFragment = `
uniform highp sampler2D u_data;uniform int u_engravingSettings;uniform vec3 u_engravingLight;uniform bool u_screenPrintOn;
flat in vec4 v_engravingAnchor,v_engravingX,v_engravingY,v_engravingRestNormal;
#define v_engravingSlot int(v_engravingAnchor.w)
#define v_engravingFog v_engravingRestNormal.w
vec4 engravingFetch(int texel){return texelFetch(u_data,ivec2(texel%2048,texel/2048),0);}
vec4 screenPrintFetch(int texel){return engravingFetch(texel);}
/*SCREEN_PRINT*/
vec4 engravingSetting(int slot,int row){return engravingFetch(u_engravingSettings*2048+(slot-1)*9+row);}
vec4 engravingTile(int start,int n,int group,vec2 uv){
 vec2 q=fract(uv)*float(n)-.5;ivec2 at=ivec2(floor(q));vec2 f=fract(q);
 ivec2 a=(at+ivec2(n))%n,b=(at+ivec2(n+1))%n;int page=group*n*n;
 return mix(mix(engravingFetch(start+page+a.y*n+a.x),engravingFetch(start+page+a.y*n+b.x),f.x),mix(engravingFetch(start+page+b.y*n+a.x),engravingFetch(start+page+b.y*n+b.x),f.x),f.y);
}
float engravingMip(int start,int n,int mip,float tone,vec2 uv){
 int offset=0;for(int i=0;i<2;i++){if(i>=mip)break;offset+=2*n*n;n/=2;}
 int lo=int(floor(tone)),hi=min(7,lo+1),a=lo/4,b=hi/4;
 vec4 p=engravingTile(start+offset,n,a,uv),q=a==b?p:engravingTile(start+offset,n,b,uv);
 return mix(p[lo%4],q[hi%4],fract(tone));
}
float engravingMap(vec4 info,vec2 uv,float tone,float lod){
 int lo=min(2,int(floor(lod))),hi=min(2,lo+1),start=int(info.x)*2048;
 float first=engravingMip(start,int(info.y),lo,tone,uv);
 return lo==hi?first:mix(first,engravingMip(start,int(info.y),hi,tone,uv),fract(min(lod,2.)));
}
vec3 engravingShade(vec3 rgb,vec2 offset){
 int slot=v_engravingSlot;if(slot<=0)return rgb;
 vec4 info=engravingSetting(slot,0),settings=engravingSetting(slot,1),ink=engravingSetting(slot,2),paper=engravingSetting(slot,3),origin=engravingSetting(slot,4);
 if(ink.w<=0.)return rgb;
 vec3 p=v_engravingAnchor.xyz+v_engravingX.xyz*offset.x+v_engravingY.xyz*offset.y-origin.xyz;
 float fogAmount=clamp(v_engravingFog,0.,1.);vec3 litRGB=fogAmount<.999?clamp((rgb-u_fog*fogAmount)/(1.-fogAmount),0.,1.):rgb;
 if(info.x<0.){
  if(!u_screenPrintOn)return rgb;
  int start=int(-info.x)*2048;float footprint=max(length(v_engravingX.xyz),length(v_engravingY.xyz));vec3 printed=vec3(0.);
  if(info.y>.5)printed=screenPrintShade(start,vec2(0.),litRGB,footprint,1.-v_engravingY.w);
  else if(info.z>2.5){vec3 w=v_engravingRestNormal.xyz;if(w.x>.001)printed+=w.x*screenPrintShade(start,p.yz,litRGB,footprint,1.-v_engravingY.w);if(w.y>.001)printed+=w.y*screenPrintShade(start,p.zx,litRGB,footprint,1.-v_engravingY.w);if(w.z>.001)printed+=w.z*screenPrintShade(start,p.xy,litRGB,footprint,1.-v_engravingY.w);}
  else{vec3 along=engravingSetting(slot,5).xyz,across=engravingSetting(slot,6).xyz;float x=dot(p,along),y=dot(p,across),z=dot(p,cross(along,across));vec2 uv=vec2(x,y);if(info.z>.5)uv=vec2(atan(z,x)*origin.w,info.z>1.5?atan(y,length(vec2(x,z)))*origin.w:y);printed=screenPrintShade(start,uv,litRGB,footprint,1.-v_engravingY.w);}
  return mix(printed,u_fog,fogAmount);
 }
 float lit=v_engravingY.w,lum=1.-clamp(dot(litRGB,vec3(.2126,.7152,.0722)),0.,1.);
 float darkness=info.w<.5?lit:info.w<1.5?lum:lit*.65+lum*.35;
 float tone=clamp(clamp((darkness-.5)*settings.z+.5+settings.w,0.,1.)*settings.y,0.,1.)*7.,lod=v_engravingX.w,coverage=0.;
 if(info.z>2.5){vec3 w=v_engravingRestNormal.xyz;if(w.x>.001)coverage+=w.x*engravingMap(info,p.yz/settings.x,tone,lod);if(w.y>.001)coverage+=w.y*engravingMap(info,p.zx/settings.x,tone,lod);if(w.z>.001)coverage+=w.z*engravingMap(info,p.xy/settings.x,tone,lod);}
 else{vec3 along=engravingSetting(slot,5).xyz,across=engravingSetting(slot,6).xyz;float x=dot(p,along),y=dot(p,across),z=dot(p,cross(along,across));vec2 uv=vec2(x,y);if(info.z>.5)uv=vec2(atan(z,x)*origin.w,info.z>1.5?atan(y,length(vec2(x,z)))*origin.w:y);coverage=engravingMap(info,uv/settings.x,tone,lod);}
 if(lod>2.){int t=int(floor(tone));vec4 a=engravingSetting(slot,7),b=engravingSetting(slot,8);float m0=t<4?a[t]:b[t-4];int t1=min(7,t+1);float m1=t1<4?a[t1]:b[t1-4];coverage=mix(coverage,mix(m0,m1,fract(tone)),lod-2.);}
 return mix(rgb,mix(mix(paper.rgb,ink.rgb,coverage),u_fog,fogAmount),ink.w);
}
`;
