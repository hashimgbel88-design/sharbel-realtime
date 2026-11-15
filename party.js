(function(root){'use strict';const {World,LEVELS}=typeof module!=='undefined'&&module.exports?require('./physics.js'):root.Rope;
function name(v){if(typeof v!=='string'||!v.trim()||v.length>24)throw Error('اسم اللاعب غير صالح');return v.trim()}
class Party{
 constructor(host,level=0){if(!Number.isInteger(level)||level<0||level>=LEVELS.length)throw Error('مرحلة غير صالحة');this.level=level;this.host='host';this.members=[{id:'host',name:name(host),input:{axis:0,jump:false},seen:Date.now(),inputAt:0}];this.phase='lobby';this.world=null;this.code=''}
 join(id,n,now=Date.now()){if(typeof id!=='string'||id==='host'||id.length>120||this.members.some(m=>m.id===id))throw Error('جلسة مكررة');if(this.phase!=='lobby')throw Error('الجولة بدأت، انتظر العودة للغرفة');if(this.members.length>=4)throw Error('الغرفة ممتلئة');this.members.push({id,name:name(n),input:{axis:0,jump:false},seen:now,inputAt:now})}
 input(id,u,now=Date.now()){const m=this.members.find(m=>m.id===id);if(!m)throw Error('انتهت الجلسة');if(!u||!Number.isFinite(u.axis)||Math.abs(u.axis)>1||typeof u.jump!=='boolean')throw Error('تحكم غير صالح');m.input={axis:u.axis,jump:u.jump};m.seen=now;m.inputAt=now}
 leave(id){if(id==='host')return;this.members=this.members.filter(m=>m.id!==id);this.phase='lobby';this.world=null}
 action(id,action){if(id!=='host')throw Error('فقط صاحب الغرفة يتحكم بالجولة');if(action==='start'){if(this.members.length<2)throw Error('تحتاج لاعب ثاني على الأقل');if(this.phase==='game')return;this.world=new World(this.members.length);this.world.level=this.level;this.world.spawn();this.phase='game'}else if(action==='next'){if(!this.world||!this.world.next())throw Error('المرحلة غير متاحة');this.level=this.world.level}else if(action==='restart'){if(this.world)this.world.reset()}else throw Error('طلب غير صالح')}
 tick(dt,now=Date.now()){for(const m of [...this.members]){if(m.id!=='host'&&now-m.seen>30000){this.leave(m.id);continue}if(now-m.inputAt>750)m.input={axis:0,jump:false}}if(this.world)this.world.step(dt,Object.fromEntries(this.members.map((m,i)=>[i,m.input])))}
 snapshot(id){return {code:this.code,host:'host',you:id,index:this.members.findIndex(m=>m.id===id),phase:this.phase,members:this.members.map(m=>({id:m.id,name:m.name})),world:this.world?this.world.snapshot():null,level:this.level}}
}
if(typeof module!=='undefined'&&module.exports)module.exports={Party};else root.Party=Party;
})(typeof globalThis!=='undefined'?globalThis:this);
