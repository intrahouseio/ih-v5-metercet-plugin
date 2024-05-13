/**
 * meters.js
 * Объект для работы с массивом счетчиков
 */
const util = require('util');

const meterlistformer = require('./meterlistformer');

module.exports = {
  list: [],
  currentMeter: 0,
  
  init(plugin) {
    this.plugin = plugin;
  },

  // Создать массив счетчиков и вспомогательную структуру 
  // this.meterSet = Map (addr: idx) для поиска по адресу
  createMeterlist(devhard) {
    this.list = meterlistformer(devhard, this.plugin);
    this.meterSet = new Map();
    this.list.forEach((item, idx) => {
      this.meterSet.set(Number(item.addr), idx);
    });
  },

  isEmpty() {
    return !this.list.length;
  },

  firstMeter ()  {
    this.currentMeter = 0;
    this.list[this.currentMeter].pollIdx = -1;
  },

  // Переключиться на следующий счетчик
  nextMeter ()  {
    this.currentMeter = this.currentMeter + 1 < this.list.length ? this.currentMeter + 1 : 0;
    this.list[this.currentMeter].pollIdx = -1;
  },

  // Выбор следующего запроса для чтения из массива polls
  // Проверить, что запрос должен читаться в этом цикле - countdown = 0
  nextPollIdx() {
    try {
      const meter = this.getCurrentMeter();
      const idx = meter.pollIdx; // индекс во внутреннем массиве polls
      
      let next_idx = idx + 1;
      while (next_idx < meter.polls.length) {
        if (meter.polls[next_idx].countdown <= 1) {
          // Взвести для след раза
          if (meter.polls[next_idx].polltimefctr > 1) {
            meter.polls[next_idx].countdown = meter.polls[next_idx].polltimefctr;
          }
          meter.pollIdx = next_idx;
          return meter.polls[next_idx].pollArrayIdx;
        }

        meter.polls[next_idx].countdown -= 1;
        next_idx += 1;
      }
    } catch (e) {
      this.plugin.log('ERROR: nextPollIdx ' + util.inspect(e));
    }
    return -1;
  },

  // Возвращает объект текущего счетчика
  getCurrentMeter () {
    return this.getMeterByIdx(this.currentMeter);
  },

  getMeterByAdr(addr) {
    if (!this.meterSet.has(addr)) return;

    const idx = this.meterSet.get(addr);
    return this.getMeterByIdx(idx);
  },

  getMeterByIdx(idx)  {
    if (idx <0 || idx >= this.list.length) return;
    return this.list[idx];
  },

  getCurrentPollArrayIdx(meter) {
    if (!meter) return;
    const pollIdx = meter.pollIdx;
    return pollIdx >=0 && pollIdx < meter.polls.length ? meter.polls[pollIdx].pollArrayIdx : -1;
  }
};
