(function(root){
'use strict';
const THEMES=[
 {name:'واحة البداية',sky:['#fff4df','#f7dfb8'],sun:'#f6cf8f',mount:'#e2c497',rock:'#ca8d62',soil:'#e2ab75',top:'#f4cf93',detail:'#ba7c55'},
 {name:'الغابة السرية',sky:['#e7f4dd','#aecfb0'],sun:'#e9dfa1',mount:'#91b6a1',rock:'#547f6e',soil:'#729477',top:'#b8d583',detail:'#446b58'},
 {name:'قمم الجليد',sky:['#e9f6ff','#bed8e9'],sun:'#fff6d4',mount:'#b3cedb',rock:'#8eafc5',soil:'#aac5d7',top:'#f1fcff',detail:'#7099b3'},
 {name:'وادي البلور',sky:['#f3e5ff','#d8b7d9'],sun:'#fbcbd9',mount:'#b69ac6',rock:'#89668f',soil:'#b489b3',top:'#edb8e2',detail:'#775780'},
 {name:'رحلة الكواكب',sky:['#182b4e','#504a72'],sun:'#edb68a',mount:'#4e5277',rock:'#6c688f',soil:'#8b7d9f',top:'#c2aed7',detail:'#57496f'}
];
const TITLES=['الانطلاقة','رفيق الدرب','الجسر البعيد','خطوة للأعلى','على الحافة','تحدي الفريق'];
const LEVELS=Array.from({length:30},(_,n)=>{
 const chapter=Math.floor(n/6),stage=n%6,platforms=[[0,510,430]],count=5+Math.floor(stage/2)+chapter;let x=430,y=510;
 for(let j=0;j<count;j++){
  const gap=85+((n*17+j*13)%4)*10+chapter*3;
  x+=gap;y=Math.max(405,Math.min(520,y+[-30,0,30,0,-15,15][(n+j)%6]));
  const width=j===count-1?430:230+((n*31+j*43)%100);
  if(j===count-1)y=510;
  platforms.push([x,y,width]);x+=width;
 }
 const last=platforms[platforms.length-1],width=last[0]+last[2];
 return {name:TITLES[stage]+' · '+THEMES[chapter].name,theme:chapter,platforms,width,finish:width-130,checkpoints:[platforms[2][0]+45,platforms[platforms.length-2][0]+45]};
});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
class World{
 constructor(count=2){this.level=0;this.count=clamp(count,1,4);this.checkpoint=90;this.deaths=0;this.elapsed=0;this.won=false;this.spawn()}
 spawn(){const floor=this.platforms.find(p=>this.checkpoint>=p[0]&&this.checkpoint<p[0]+p[2]);this.players=Array.from({length:this.count},(_,i)=>({x:this.checkpoint+i*34,y:(floor?floor[1]:510)-30,vx:0,vy:0,grounded:true,held:false}));}
 get platforms(){return LEVELS[this.level].platforms}
 get stage(){return LEVELS[this.level]}
 reset(){this.spawn();this.won=false}
 next(){if(!this.won||this.level>=LEVELS.length-1)return false;this.level++;this.checkpoint=90;this.won=false;this.spawn();return true}
 step(dt,inputs={}){
  dt=Number.isFinite(dt)?clamp(dt,0,1/30):0;if(this.won)return;
  if(this.players.some(p=>p.y>850)){this.deaths++;this.spawn();return}
  this.elapsed+=dt;
  for(let i=0;i<this.players.length;i++){
   const p=this.players[i],u=inputs[i]||{},axis=Number.isFinite(u.axis)?clamp(u.axis,-1,1):0;
   p.vx+=(axis*220-p.vx)*Math.min(1,dt*12);
   if(u.jump&&!p.held&&p.grounded){p.vy=-560;p.grounded=false}p.held=!!u.jump;p.vy+=1350*dt;
  }
  for(let i=1;i<this.players.length;i++){
   const p=this.players[i-1],q=this.players[i],dx=q.x-p.x,dy=q.y-p.y,d=Math.hypot(dx,dy);
   if(d>135){const f=Math.min(900,(d-135)*24)*dt;p.vx+=dx/d*f;p.vy+=dy/d*f;q.vx-=dx/d*f;q.vy-=dy/d*f;}
  }
  // A teammate on solid ground can haul the next player up the rope.
  for(let i=0;i<this.players.length;i++){
   const falling=this.players[i];
   if(falling.grounded){delete falling.rescueAnchor;continue}
   const anchorIndex=[i-1,i+1].find(index=>{
    const anchor=this.players[index],axis=inputs[index]?.axis;
    if(!anchor?.grounded||!Number.isFinite(axis)||Math.abs(axis)<.1)return false;
    if(falling.rescueAnchor===index)return Math.sign(axis)===falling.rescueDirection;
    return falling.y>anchor.y+24&&axis*(anchor.x-falling.x)>0
     &&Math.hypot(anchor.x-falling.x,anchor.y-falling.y)>100;
   });
   if(anchorIndex===undefined){delete falling.rescueAnchor;continue}
   const anchor=this.players[anchorIndex];
   const platform=this.platforms.find(([x,y,w])=>anchor.x>=x&&anchor.x<=x+w&&Math.abs(anchor.y+30-y)<4);
   if(!platform){delete falling.rescueAnchor;continue}
   if(falling.y<anchor.y-25&&falling.x>platform[0]+12&&falling.x<platform[0]+platform[2]-12){
    delete falling.rescueAnchor;
    continue;
   }
   falling.rescueAnchor=anchorIndex;
   falling.rescueDirection=Math.sign(inputs[anchorIndex].axis);
   const target=clamp(anchor.x,platform[0]+16,platform[0]+platform[2]-16);
   falling.vx=clamp((target-falling.x)*6,-260,260);
   falling.vy=falling.y>anchor.y-46?-285:0;
  }
  const prev=this.players.map(p=>({x:p.x,y:p.y,grounded:p.grounded}));
  for(const p of this.players){p.vx=clamp(p.vx,-260,260);p.vy=clamp(p.vy,-700,900);p.x=clamp(p.x+p.vx*dt,15,this.stage.width-20);p.y+=p.vy*dt;p.grounded=false;}
  for(let n=0;n<5;n++)for(let i=1;i<this.players.length;i++){
   const p=this.players[i-1],q=this.players[i],dx=q.x-p.x,dy=q.y-p.y,d=Math.hypot(dx,dy);
   if(d>170){
    const share=prev[i-1].grounded&&dy>24?0:prev[i].grounded&&dy<-24?1:.5;
    const excess=d-170;
    p.x+=dx/d*excess*share;p.y+=dy/d*excess*share;
    q.x-=dx/d*excess*(1-share);q.y-=dy/d*excess*(1-share);
   }
  }
  for(let i=0;i<this.players.length;i++){
   const p=this.players[i];p.x=clamp(p.x,15,this.stage.width-20);
   for(const [x,y,w] of this.platforms){
    if(p.x+12>x&&p.x-12<x+w&&prev[i].y+30<=y+4&&p.y+30>=y&&p.vy>=0){p.y=y-30;p.vy=0;p.grounded=true;break}
   }
  }
  for(const cp of LEVELS[this.level].checkpoints)if(cp>this.checkpoint&&this.players.every(p=>p.x>=cp&&p.grounded))this.checkpoint=cp;
  if(this.players.every(p=>p.x>=this.stage.finish&&p.grounded))this.won=true;
 }
 snapshot(){return {level:this.level,checkpoint:this.checkpoint,deaths:this.deaths,elapsed:this.elapsed,won:this.won,players:this.players.map(p=>({...p}))}}
}
const api={World,LEVELS,THEMES};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Rope=api;
})(typeof globalThis!=='undefined'?globalThis:this);
