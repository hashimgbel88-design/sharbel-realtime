'use strict';
const invalid=()=>{const e=Error('بيانات الاتصال الصوتي غير صالحة');e.status=400;throw e};
function relayVoice(room,actor,b,now){
 if(typeof b.enabled!=='boolean'||typeof b.call!=='string'||!/^[a-f0-9]{32}$/.test(b.call)||!Number.isSafeInteger(b.seq)||b.seq<0||!Number.isSafeInteger(b.ack)||b.ack<0||!Array.isArray(b.signals)||b.signals.length>8)invalid();
 for(const s of b.signals){
  if(!s||typeof s.to!=='string'||s.to.length>100||typeof s.toCall!=='string'||!/^[a-f0-9]{32}$/.test(s.toCall)||!['offer','answer','candidate'].includes(s.type))invalid();
  if(s.type==='candidate'){const c=s.data;if(!c||typeof c.candidate!=='string'||c.candidate.length>2048||(c.sdpMid!==null&&typeof c.sdpMid!=='string')||(c.sdpMid&&c.sdpMid.length>20)||(c.sdpMLineIndex!==null&&(!Number.isInteger(c.sdpMLineIndex)||c.sdpMLineIndex<0||c.sdpMLineIndex>8)))invalid()}
  else if(typeof s.data!=='string'||s.data.length>16000)invalid();
 }
 const p=room.party;room.voiceMessages=room.voiceMessages||[];room.voiceSerial=room.voiceSerial||0;
 const fresh=b.seq>(actor.voice?.seq??-1);
 if(fresh){
  actor.voice={enabled:b.enabled,call:b.call,seq:b.seq,at:now};
  room.voiceMessages=room.voiceMessages.filter(m=>!(m.to===actor.id&&m.id<=b.ack));
  if(b.enabled)for(const s of b.signals){const target=p.members.find(m=>m.id===s.to);if(!target||target===actor||!target.voice?.enabled||target.voice.call!==s.toCall||now-target.voice.at>6000)continue;room.voiceMessages.push({id:++room.voiceSerial,from:actor.id,fromCall:b.call,to:s.to,toCall:s.toCall,type:s.type,data:s.data,at:now})}
 }
 const active=m=>m.voice?.enabled&&now-m.voice.at<=6000;
 room.voiceMessages=room.voiceMessages.filter(m=>{const from=p.members.find(p=>p.id===m.from),to=p.members.find(p=>p.id===m.to);return now-m.at<30000&&from&&to&&active(from)&&active(to)&&from.voice.call===m.fromCall&&to.voice.call===m.toCall}).slice(-128);
 return {you:actor.id,peers:p.members.filter(active).map(m=>({id:m.id,name:m.name,call:m.voice.call})),messages:room.voiceMessages.filter(m=>m.to===actor.id&&m.toCall===b.call&&m.id>b.ack).slice(0,24)};
}

module.exports = { relayVoice };
