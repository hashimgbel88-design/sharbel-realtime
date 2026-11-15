'use strict';

const { randomBytes } = require('node:crypto');
const { Party } = require('./engine/party.js');
const { World } = require('./engine/physics.js');

const STEP = 1 / 60;
const HISTORY_TICKS = 90;
const cloneControls = controls => controls.map(control => ({ ...control }));

class GameRoom {
  constructor(code, name, level = 0) {
    this.code = code;
    this.party = new Party(name, level);
    this.party.code = code;
    this.tokens = new Map();
    this.received = new Map();
    this.round = 0;
    this.tick = 0;
    this.events = new Map();
    this.history = new Map();
    this.controls = [];
    this.actionIds = new Set();
    this.closed = false;
  }

  issueSession(id) {
    const token = randomBytes(32).toString('hex');
    this.tokens.set(token, id);
    this.received.set(id, { seq: 0, tick: 0 });
    return { code: this.code, token, playerId: id };
  }

  createSession() {
    return this.issueSession('host');
  }

  join(name) {
    const id = randomBytes(8).toString('hex');
    this.party.join(id, name);
    return this.issueSession(id);
  }

  authenticate(token) {
    const id = this.tokens.get(token);
    if (!id || this.closed || !this.party.members.some(member => member.id === id)) {
      throw Error('انتهت جلسة الغرفة');
    }
    return id;
  }

  member(id) {
    const member = this.party.members.find(item => item.id === id);
    if (!member || this.closed) throw Error('انتهت جلسة الغرفة');
    return member;
  }

  resetTimeline() {
    this.round++;
    this.tick = 0;
    this.events.clear();
    this.history.clear();
    this.controls = this.party.members.map(() => ({ axis: 0, jump: false, seq: 0, lastTick: 0 }));
    for (const member of this.party.members) this.received.set(member.id, { seq: 0, tick: 0 });
    if (this.party.world) this.saveFrame();
  }

  action(id, action, requestId) {
    if (id !== 'host') throw Error('فقط صاحب الغرفة يتحكم بالجولة');
    const key = String(requestId);
    if (this.actionIds.has(key)) return;
    if (!['start', 'next', 'restart'].includes(action)) throw Error('طلب غير صالح');
    if (action === 'start' && this.party.phase === 'game') return;
    this.party.action(id, action);
    this.resetTimeline();
    this.actionIds.add(key);
    if (this.actionIds.size > 64) this.actionIds.delete(this.actionIds.values().next().value);
  }

  saveFrame() {
    this.history.set(this.tick, {
      world: this.party.world.snapshot(),
      controls: cloneControls(this.controls)
    });
    const oldest = this.tick - HISTORY_TICKS;
    for (const tick of this.history.keys()) if (tick < oldest) this.history.delete(tick);
    for (const tick of this.events.keys()) if (tick <= oldest) this.events.delete(tick);
  }

  step() {
    if (!this.party.world || this.closed) return;
    const tick = this.tick + 1;
    const events = this.events.get(tick);
    const input = {};
    for (let index = 0; index < this.party.members.length; index++) {
      const id = this.party.members[index].id;
      const command = events?.get(id);
      if (command) this.controls[index] = { ...command, lastTick: tick };
      const control = this.controls[index];
      input[index] = tick - control.lastTick > 30 ? { axis: 0, jump: false } : control;
    }
    this.party.world.step(STEP, input);
    this.tick = tick;
    this.saveFrame();
  }

  submit(id, round, commands) {
    this.member(id);
    if (round !== this.round || !this.party.world) return false;
    if (!Array.isArray(commands) || commands.length < 1 || commands.length > 12) {
      throw Error('حزمة أوامر غير صالحة');
    }
    for (const command of commands) {
      if (!command || !Number.isSafeInteger(command.seq) || command.seq < 1 ||
          !Number.isSafeInteger(command.tick) || command.tick < 1 ||
          ![-1, 0, 1].includes(command.axis) || typeof command.jump !== 'boolean') {
        throw Error('أمر حركة غير صالح');
      }
    }
    const received = this.received.get(id);
    let earliest = Infinity;
    let lastSeq = received.seq;
    let lastTick = received.tick;
    const accepted = [];
    for (const command of commands) {
      if (command.seq <= lastSeq) continue;
      if (command.tick < lastTick || command.tick > this.tick + 12 ||
          !this.history.has(Math.min(command.tick - 1, this.tick))) return false;
      accepted.push(command);
      lastSeq = command.seq;
      lastTick = command.tick;
    }
    for (const command of accepted) {
      let events = this.events.get(command.tick);
      if (!events) this.events.set(command.tick, events = new Map());
      events.set(id, { axis: command.axis, jump: command.jump, seq: command.seq });
      earliest = Math.min(earliest, command.tick);
    }
    received.seq = lastSeq;
    received.tick = lastTick;
    if (earliest <= this.tick) {
      const previousTick = this.tick;
      const frame = this.history.get(earliest - 1);
      this.party.world = Object.assign(new World(this.party.members.length), frame.world, {
        players: frame.world.players.map(player => ({ ...player }))
      });
      this.controls = cloneControls(frame.controls);
      this.tick = earliest - 1;
      while (this.tick < previousTick) this.step();
    }
    return true;
  }

  neutralize(id) {
    if (!this.party.world) return;
    let events = this.events.get(this.tick + 1);
    if (!events) this.events.set(this.tick + 1, events = new Map());
    for (const [tick, pending] of this.events) if (tick > this.tick) pending.delete(id);
    events.set(id, { axis: 0, jump: false, seq: this.received.get(id).seq });
  }

  leave(id) {
    if (id === 'host') {
      this.closed = true;
      return;
    }
    this.party.leave(id);
    for (const [token, playerId] of this.tokens) if (playerId === id) this.tokens.delete(token);
    this.received.delete(id);
    this.resetTimeline();
  }

  snapshot(id) {
    const index = this.party.members.findIndex(member => member.id === id);
    return {
      ...this.party.snapshot(id),
      protocol: 'sharbel-realtime-v1',
      serverTime: Date.now(),
      round: this.round,
      tick: this.tick,
      ack: this.controls[index]?.seq || 0,
      accepted: this.received.get(id)?.seq || 0,
      controls: this.controls.map(control => ({ axis: control.axis, jump: control.jump }))
    };
  }
}

module.exports = { GameRoom, STEP };
