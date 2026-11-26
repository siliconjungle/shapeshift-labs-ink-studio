const el=id=>document.getElementById(id);
const formats=[...new Set(textures.rows.map(row=>row.encoding))];
const buttons=new Map(), select=el('view'), texture=el('texture');
const value=n=>Number.isInteger(n)?String(n):n.toFixed(6);
const size=bytes=>new Intl.NumberFormat('en',{maximumFractionDigits:1}).format(bytes/1024)+' KiB';
el('extent').textContent=textures.width+' × '+textures.height+' px';
el('probe').textContent='Texel ('+textures.probe.join(', ')+')';
for(const format of formats){
  const button=document.createElement('button');
  button.type='button';
  button.textContent=format;
  button.onclick=()=>chooseFormat(format);
  el('formats').append(button);
  buttons.set(format,button);
}
function chooseFormat(format){
  for(const [name,button] of buttons)button.setAttribute('aria-pressed',String(name===format));
  const options=textures.rows.flatMap((row,index)=>row.encoding===format?[new Option(row.title,String(index))]:[]);
  select.replaceChildren(...options);
  show();
}
function list(label,items){
  if(!items.length)return;
  const heading=document.createElement('div'), ul=document.createElement('ul');
  heading.className='label';
  heading.textContent=label;
  for(const name of items){
    const li=document.createElement('li');
    li.textContent=name;
    ul.append(li);
  }
  el('inventory').append(heading,ul);
}
function show(){
  const row=textures.rows[Number(select.value)];
  texture.src=row.image;
  texture.alt=row.title+' decoded from '+row.encoding;
  el('caption').textContent=row.title;
  el('title').textContent=row.encoding+' · '+row.title;
  el('detail').textContent=row.detail;
  el('precision').textContent=row.precision;
  el('alpha').textContent=row.alpha==='none'||!row.alpha?'None':row.alpha;
  el('profile').textContent=row.profile||'None';
  el('bytes').textContent=size(row.fileBytes);
  el('inventory').replaceChildren();
  if(row.layers)list('Layers',row.layers.map(layer=>layer.name));
  if(row.masks)list('Named masks',row.masks);
  if(row.channels)list('Channels',[row.channels.join(', ')]);
  el('sample').textContent=row.sample.map(value).join('  /  ');
  const download=el('download');
  download.href=row.file;
  download.textContent='Download '+row.file.split('/').pop()+' ↓';
}
select.onchange=show;
chooseFormat('PNG');
