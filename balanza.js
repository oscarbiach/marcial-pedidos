/* Lectura local del visor rojo de PESO. Las fotos no salen del dispositivo.
   Toda lectura se confirma viendo el recorte; nunca se deduce el decimal. */
(function () {
  'use strict';
  let carga;
  function motor() {
    if(window.Tesseract)return Promise.resolve();
    if(!carga)carga=new Promise((resolve,reject)=>{
      const s=document.createElement('script');s.src='vendor/tesseract/tesseract.min.js';
      s.onload=resolve;s.onerror=()=>{carga=null;s.remove();reject(Error('No se pudo cargar el lector.'));};document.head.appendChild(s);
    });
    return carga;
  }
  function lienzo(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
  async function imagen(file){
    const url=URL.createObjectURL(file),img=new Image();
    try{await new Promise((ok,no)=>{img.onload=ok;img.onerror=no;img.src=url;});
      const escala=Math.min(1,1600/Math.max(img.width,img.height)),c=lienzo(Math.round(img.width*escala),Math.round(img.height*escala));
      c.getContext('2d').drawImage(img,0,0,c.width,c.height);return c;
    }finally{URL.revokeObjectURL(url);}
  }
  function visor(c){
    const w=c.width,h=c.height,d=c.getContext('2d').getImageData(0,0,w,h).data,seen=new Uint8Array(w*h),grupos=[];
    const rojo=p=>d[p*4]>145&&d[p*4]-d[p*4+1]>65&&d[p*4]-d[p*4+2]>55;
    for(let y=0;y<h*.78;y++)for(let x=0;x<w;x++){
      const p=y*w+x;if(seen[p]||!rojo(p))continue;
      const pila=[p];seen[p]=1;let left=x,right=x,top=y,bottom=y,n=0;
      for(let j=0;j<pila.length;j++){
        const q=pila[j],qx=q%w,qy=Math.floor(q/w);n++;left=Math.min(left,qx);right=Math.max(right,qx);top=Math.min(top,qy);bottom=Math.max(bottom,qy);
        for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]){const xx=qx+dx,yy=qy+dy,k=yy*w+xx;if(xx>=0&&xx<w&&yy>=0&&yy<h*.78&&!seen[k]&&rojo(k)){seen[k]=1;pila.push(k);}}
      }
      if(n>8&&bottom-top>h*.006&&bottom-top<h*.6)grupos.push({left,right,top,bottom,n});
    }
    // El visor de peso es el superior, con varios dígitos rojos alineados.
    const candidatos=[];
    for(const a of grupos){const alto=a.bottom-a.top;
      const fila=grupos.filter(b=>Math.abs((b.top+b.bottom-a.top-a.bottom)/2)<alto*.65&&b.bottom-b.top>alto*.45&&b.bottom-b.top<alto*1.8&&Math.abs(b.left-a.left)<alto*7);
      const l=Math.min(...fila.map(b=>b.left)),r=Math.max(...fila.map(b=>b.right)),t=Math.min(...fila.map(b=>b.top)),b=Math.max(...fila.map(b=>b.bottom));
      if((r-l)/(b-t)>1.25&&(r-l)/(b-t)<6&&fila.reduce((n,g)=>n+g.n,0)>40)candidatos.push({x:l,y:t,w:r-l+1,h:b-t+1});
    }
    candidatos.sort((a,b)=>a.y-b.y||b.w-a.w);const v=candidatos[0];
    if(!v)return null;
    const pad=Math.max(5,v.h*.18);return {x:Math.max(0,v.x-pad),y:Math.max(0,v.y-pad),w:Math.min(w-v.x+pad,v.w+pad*2),h:Math.min(h-v.y+pad,v.h+pad*2)};
  }
  function interpretar(text){
    const s=String(text).trim().replace(/\s/g,'').replace(',','.');
    return /^\d{1,3}\.\d{1,3}$/.test(s)&&Number(s)>0&&Number(s)<=150?Number(s):null;
  }
  function resultadoTexto(text,recorte){
    const peso=interpretar(text),s=String(text).trim().replace(/\s/g,'');
    if(peso!==null)return {peso,recorte,texto:text};
    // El OCR suele perder el punto por el brillo: conservar los dígitos y
    // pedir al usuario que elija el decimal mirando el visor, sin adivinarlo.
    const opciones=[];
    if(/^\d{3,6}$/.test(s))for(let i=Math.max(1,s.length-3);i<s.length;i++){
      const n=Number(s.slice(0,i)+'.'+s.slice(i));if(n>0&&n<=150&&!opciones.includes(n))opciones.push(n);
    }
    return {peso:null,recorte,texto:text,...(opciones.length?{opciones}:{})};
  }
  function segmentos(c,limite=140,diferencia=50,ambiguo=false){
    const w=c.width,h=c.height,d=c.getContext('2d').getImageData(0,0,w,h).data;
    const mask=new Uint8Array(w*h),cols=new Uint32Array(w);
    for(let i=0;i<mask.length;i++)if(d[i*4+1]>limite&&d[i*4]-d[i*4+2]>diferencia&&d[i*4]>210){mask[i]=1;cols[i%w]++;}
    const runs=[];let start=null;
    for(let x=0;x<=w;x++){if(x<w&&cols[x]>Math.max(2,h*.03)){if(start===null)start=x;}else if(start!==null){runs.push([start,x]);start=null;}}
    const separados=[];
    for(const [l,r] of runs){
      let top=h,bottom=0;for(let y=0;y<h;y++)for(let x=l;x<r;x++)if(mask[y*w+x]){top=Math.min(top,y);bottom=Math.max(bottom,y+1);}
      const dh=bottom-top,n=Math.round((r-l)/(dh*.52));
      if((r-l)/dh>.78&&n>=2&&n<=5){let a=l;for(let j=1;j<n;j++){const target=l+(r-l)*j/n;let cut=Math.round(target),score=Infinity;
        for(let x=Math.max(a+5,Math.floor(target-dh*.14));x<Math.min(r-5,target+dh*.14);x++)if(cols[x]<score){cut=x;score=cols[x];}
        separados.push([a,cut]);a=cut;}separados.push([a,r]);
      }else separados.push([l,r]);
    }
    const digits=[],map={'1111110':'0','1111001':'3','1011011':'5','1011111':'6','1110000':'7','1111000':'7','1111111':'8','1111011':'9','1101101':'2','0110011':'4'};
    for(let ri=0;ri<separados.length;ri++){
      const [l,r]=separados[ri];
      let top=h,bottom=0;for(let y=0;y<h;y++){let n=0;for(let x=l;x<r;x++)n+=mask[y*w+x];if(n>1){top=Math.min(top,y);bottom=y+1;}}
      const dh=bottom-top,dw=r-l;if(dh<h*.3||dw<3)continue;
      let digit;
      if(dw/dh<.33)digit='1';
      else{
        const regs=[[.2,.8,0,.2],[.65,1,.12,.45],[.65,1,.55,.88],[.2,.8,.8,1],[0,.35,.55,.88],[0,.35,.12,.45],[.35,.65,.42,.58]];
        const bits=regs.map(([a,b,t,z],i)=>{let yes=0,n=0;for(let y=Math.floor(top+t*dh);y<top+z*dh;y++)for(let x=Math.floor(l+a*dw);x<l+b*dw;x++){yes+=mask[y*w+x]||0;n++;}return yes/n>([0,3,6].includes(i)?.38:[4,5].includes(i)?.25:.20)?'1':'0';}).join('');
        digit=map[bits];
      }
      if(!digit)return null;
      let midRight=l,lowRight=l;
      for(let y=Math.floor(top+dh*.55);y<bottom;y++)for(let x=l;x<(separados[ri+1]?.[0]||r);x++)if(mask[y*w+x]){if(y<top+dh*.8)midRight=Math.max(midRight,x);else lowRight=Math.max(lowRight,x);}
      digits.push({digit,dot:lowRight-midRight>dh*.06});
    }
    if(digits.length<3||digits.length>6)return null;
    if(digits.filter(x=>x.dot).length!==1)return ambiguo?digits.map(x=>x.digit).join(''):null;
    return interpretar(digits.map(x=>x.digit+(x.dot?'.':'')).join(''));
  }
  async function leer(file){
    const c=await imagen(file),v=visor(c);if(!v)return {peso:null,recorte:null};
    const crop=lienzo(Math.round(v.w*4),Math.round(v.h*4)),ctx=crop.getContext('2d');ctx.drawImage(c,v.x,v.y,v.w,v.h,0,0,crop.width,crop.height);
    const recorte=crop.toDataURL('image/jpeg');
    const led=segmentos(crop)??segmentos(crop,180,10);if(led!==null)return {peso:led,recorte,texto:String(led),metodo:'segmentos'};
    const digitos=segmentos(crop,180,10,true);
    if(typeof digitos==='string'){
      return {...resultadoTexto(digitos,recorte),metodo:'segmentos-decimal'};
    }
    await motor();const base=new URL('vendor/tesseract/',location.href).href;
    let worker;
    try{
      worker=await Tesseract.createWorker('eng',1,{workerPath:base+'worker.min.js',corePath:base,langPath:base,workerBlobURL:false});
      await worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789.',user_defined_dpi:'300'});
      const data=ctx.getImageData(0,0,crop.width,crop.height);
      // El verde conserva el núcleo luminoso y descarta el halo rojo.
      for(let i=0;i<data.data.length;i+=4){const k=255-data.data[i+1];data.data[i]=data.data[i+1]=data.data[i+2]=k;}
      ctx.putImageData(data,0,0);const r=await worker.recognize(crop);
      return resultadoTexto(r.data.text,recorte);
    }finally{if(worker)await worker.terminate();}
  }
  window.Balanza={leer,visor,interpretar,segmentos,resultadoTexto};
})();
