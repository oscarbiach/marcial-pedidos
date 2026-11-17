/* Fuentes de peso distintas del LED rojo: LCD y etiquetas de peso neto.
   Procesamiento local, sin enviar fotos a servicios de reconocimiento. */
(function(){
 'use strict';
 const canvas=(w,h)=>Object.assign(document.createElement('canvas'),{width:Math.max(1,Math.ceil(w)),height:Math.max(1,Math.ceil(h))});
 function recortar(c,b,scale=2){const o=canvas(b.w*scale,b.h*scale);o.getContext('2d').drawImage(c,b.x,b.y,b.w,b.h,0,0,o.width,o.height);return o;}
 function rotar(c,angle){const a=angle*Math.PI/180,o=canvas(Math.abs(c.width*Math.cos(a))+Math.abs(c.height*Math.sin(a)),Math.abs(c.height*Math.cos(a))+Math.abs(c.width*Math.sin(a))),ctx=o.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,o.width,o.height);ctx.translate(o.width/2,o.height/2);ctx.rotate(a);ctx.drawImage(c,-c.width/2,-c.height/2);return o;}
 function pantallas(c){
  const scale=Math.min(1,900/Math.max(c.width,c.height)),s=recortar(c,{x:0,y:0,w:c.width,h:c.height},scale),w=s.width,h=s.height,d=s.getContext('2d').getImageData(0,0,w,h).data,out=[];
  const filtros={verde:(r,g,b)=>g>115&&g>r*1.5&&g>b*1.5,azul:(r,g,b)=>r>170&&g>190&&b>205,apagado:(r,g,b)=>r>50&&g>50&&r/g>.85&&r/g<1.12&&Math.min(r,g)-b>7&&r<140&&g<145};
  for(const [tipo,f] of Object.entries(filtros)){
   const seen=new Uint8Array(w*h);
   for(let p=0;p<w*h;p++){
    if(seen[p]||!f(d[4*p],d[4*p+1],d[4*p+2]))continue;
    const q=[p];seen[p]=1;let l=p%w,r=l,t=Math.floor(p/w),b=t;
    for(let j=0;j<q.length;j++){const z=q[j],x=z%w,y=Math.floor(z/w);l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);
     for(const [xx,yy] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){const k=yy*w+xx;if(xx>=0&&xx<w&&yy>=0&&yy<h&&!seen[k]&&f(d[k*4],d[k*4+1],d[k*4+2])){seen[k]=1;q.push(k);}}
    }
    const bw=r-l+1,bh=b-t+1,ratio=bw/bh,fill=q.length/(bw*bh);
    if(bw>w*.13&&bh>h*.025&&bh<h*.3&&ratio>1.3&&ratio<4.5&&fill>.50){
     const tops=new Map();for(const z of q){const x=z%w,y=Math.floor(z/w);if(!tops.has(x)||y<tops.get(x))tops.set(x,y);}
     const pts=[...tops].filter(([x])=>x>l+bw*.15&&x<r-bw*.15);let n=pts.length,sx=0,sy=0,sxx=0,sxy=0;for(const [x,y] of pts){sx+=x;sy+=y;sxx+=x*x;sxy+=x*y;}
     const angle=-Math.atan((n*sxy-sx*sy)/(n*sxx-sx*sx)||0)*180/Math.PI;
     out.push({tipo,x:l/scale,y:t/scale,w:bw/scale,h:bh/scale,area:q.length,angle:Math.abs(angle)<15?angle:0});
    }
   }
  }
  // Peso: primer visor de cada panel. Los de precio, más abajo/a la derecha,
  // nunca se usan como alternativa si la primera lectura falla.
  return out.sort((a,b)=>a.y-b.y||a.x-b.x);
 }
 function binario(c,tipo){
  const o=canvas(c.width,c.height),ctx=o.getContext('2d');ctx.drawImage(c,0,0);const d=ctx.getImageData(0,0,o.width,o.height);
  const iw=o.width+1,integral=new Float64Array(iw*(o.height+1));
  if(tipo==='apagado')for(let y=0;y<o.height;y++){let sum=0;for(let x=0;x<o.width;x++){const i=(y*o.width+x)*4;sum+=(d.data[i]+d.data[i+1])/2;integral[(y+1)*iw+x+1]=integral[y*iw+x+1]+sum;}}
  for(let i=0;i<d.data.length;i+=4){const [r,g,b]=d.data.slice(i,i+3);let threshold=58;
   if(tipo==='apagado'){const x=(i/4)%o.width,y=Math.floor(i/4/o.width),rad=Math.round(o.height*.16),l=Math.max(0,x-rad),rr=Math.min(o.width,x+rad+1),t=Math.max(0,y-rad),bb=Math.min(o.height,y+rad+1);threshold=(integral[bb*iw+rr]-integral[t*iw+rr]-integral[bb*iw+l]+integral[t*iw+l])/((rr-l)*(bb-t))-5;}
   const ink=tipo==='verde'?g<145:tipo==='azul'?(r<200&&g<225&&b>r*1.08):(r+g)/2<threshold;
   d.data[i]=ink?255:0;d.data[i+1]=ink?230:0;d.data[i+2]=0;
  }
  // Quitar el marco conectado a los bordes antes de separar los dígitos.
  const w=o.width,h=o.height,seen=new Uint8Array(w*h);
  for(let p=0;p<w*h;p++){if(seen[p]||!d.data[p*4])continue;const q=[p];seen[p]=1;let edge=false;
   for(let j=0;j<q.length;j++){const z=q[j],x=z%w,y=Math.floor(z/w);if(x===0||y===0||x===w-1||y===h-1)edge=true;
    for(const [xx,yy] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){const k=yy*w+xx;if(xx>=0&&xx<w&&yy>=0&&yy<h&&!seen[k]&&d.data[k*4]){seen[k]=1;q.push(k);}}}
   if(edge)for(const z of q)d.data[z*4]=d.data[z*4+1]=0;
  }
  ctx.putImageData(d,0,0);return o;
 }
 function lineas(data){return (data.blocks||[]).flatMap(b=>(b.paragraphs||[]).flatMap(p=>p.lines||[]));}
 function contraste(c){const ctx=c.getContext('2d'),d=ctx.getImageData(0,0,c.width,c.height);for(let i=0;i<d.data.length;i+=4){const k=Math.max(0,Math.min(255,(d.data[i]*.3+d.data[i+1]*.59+d.data[i+2]*.11-20)*2.2));d.data[i]=d.data[i+1]=d.data[i+2]=k;}ctx.putImageData(d,0,0);return c;}
 async function leer(c,worker){
  const panels=pantallas(c);
  if(panels.length){
   const p=panels[0],panel=p.tipo==='apagado'?recortar(c,p,3):rotar(recortar(c,p,3),p.angle),b={x:0,y:panel.height*(p.tipo==='apagado'?0:.04),w:panel.width,h:panel.height*(p.tipo==='verde'?.92:p.tipo==='apagado'?.46:.42)},crop=recortar(panel,b,1),mask=binario(crop,p.tipo);
   const str=Balanza.segmentos(mask,140,50,'digitos');
   if(str&&/^\d{4,6}$/.test(str)){const peso=Number(str)/1000;if(peso>0&&peso<=150)return {peso,dudoso:true,tipo:'lcd',recorte:crop.toDataURL('image/jpeg')};}
   const w=await worker();await w.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789.,'});
   const ctx=mask.getContext('2d'),data=ctx.getImageData(0,0,mask.width,mask.height);for(let i=0;i<data.data.length;i+=4){const k=255-data.data[i];data.data[i]=data.data[i+1]=data.data[i+2]=k;}ctx.putImageData(data,0,0);
   const r=await w.recognize(mask),s=r.data.text.replace(/\s/g,'');
   const peso=/^\d{1,3}[.,]\d{3}$/.test(s)?Number(s.replace(',','.')):/^\d{4,6}$/.test(s)?Number(s)/1000:null;
   return {peso:peso>0&&peso<=150?peso:null,dudoso:true,tipo:'lcd',recorte:crop.toDataURL('image/jpeg')};
  }
  // Las etiquetas pueden estar inclinadas. Exigir PESO NETO evita tomar
  // bruto, tara, unidades, fechas y códigos de barras como kilos.
  const w=await worker();
  for(const angle of [0,25,45,-25,-45,90,-90]){
   const img=angle===45||angle===-45?contraste(rotar(c,angle)):rotar(c,angle);await w.setParameters({tessedit_pageseg_mode:'11',tessedit_char_whitelist:''});
   const r=await w.recognize(img,{}, {text:true,blocks:true}),ls=lineas(r.data),label=ls.find(l=>/P[EI]SO\s+NETO/i.test(l.text));
   if(!label)continue;
   const bb=label.bbox,bw=bb.x1-bb.x0,bh=bb.y1-bb.y0;
   const crop=recortar(img,{x:Math.max(0,bb.x0-bw*.06),y:bb.y1+bh*.12,w:bw*1.12,h:bh*2.3},3);
   await w.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789.,'});
   const result=await w.recognize(crop),peso=Balanza.interpretar(result.data.text);
   return {peso,dudoso:true,tipo:'etiqueta',recorte:crop.toDataURL('image/jpeg')};
  }
  return {peso:null,dudoso:true,tipo:'desconocido'};
 }
 window.PesoFuentes={leer,pantallas,binario,recortar,rotar};
})();
