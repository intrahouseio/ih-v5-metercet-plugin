/**
 * agent.js
 * Последовательный опрос счетчиков
 * Для адресации используется длинный адрес longadr (серийный номер счетчика)
 * Опрос через tcp клиент
 */

const util = require('util');
const net = require('net');

const protocol = require('./protocol');

// const networkErrors = ['ESOCKETTIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH'];
// const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class Agent {
  constructor(plugin, params) {
    this.plugin = plugin;
    this.params = params;
    this.checkInterval = 0;

    this.waiting = 0; // Флаг ожидания
    this.sendTime = 0; // Время отправки последнего запроса
  }

  /**
   *
   * @param {Array of Objects} meterlist  - массив счетчиков: [{longadr, assets:{}, chans},..]
   */
  run(meterlist) {
    if (!this.prepare(meterlist)) return;

    const host = this.params.host;
    const port = Number(this.params.port);
    this.timeout = this.params.timeout || 5000;
    this.polldelay = this.params.polldelay || 200; // Интервал между запросами
    this.plugin.log('Try connect to ' + host + ':' + port);

    this.client = net.createConnection({ host, port }, () => {
      this.isOpen = true;
      this.plugin.log('TCP client connected to ' + host + ':' + port);
      this.startPolling();
    });

    this.client.on('data', data => {
      this.waiting = 0;
      if (!this.refreshMeterlist) {
        this.processIncomingMessage(data);
      } else {
        // При обновлении каналов последний результат игнорируется - счетчика может уже не быть
        this.refreshMeterlist = false;
      }
      setTimeout(() => {
        this.sendNext();
      }, this.polldelay);
    });

    this.client.on('end', () => {
      this.processExit(1, 'TCP client disconnected');
    });

    this.client.on('error', e => {
      this.processExit(1, 'ERROR: TCP client: Connection error:  ' + e.code);
    });
  }

  /**
   * Подготовительные операции при старте | обновлении списка счетчиков
   *  - формирует структуру для поиска в массиве meterlist по адресу счетчика
   *    this.meterSet : Map(longadr => idx)
   *  - формирует массив для опроса одного счетчика
   *
   * @param {*} meterlist
   * @return {Bool} -
   */
  prepare(meterlist) {
    if (!meterlist || !meterlist.length) {
      this.processExit(3, 'Список счетчиков пуст! Нет каналов для опроса...');
      return;
    }
    this.meterlist = meterlist;
    this.meterSet = new Map();
    meterlist.forEach((item, idx) => {
      this.meterSet.set(Number(item.longadr), idx);
    });
    this.pollArray = protocol.createOnePollArray();
    // this.plugin.log('One meter POLL ARRAY:' + util.inspect(this.pollArray), 1);
    return true;
  }

  // Старт опроса
  startPolling() {
    this.currentMeterIdx = 0; // индекс в meterlist
    this.sendNext();
    setInterval(this.checkResponse.bind(this), 1000);
  }

  // Вызывается при обновлении списка счетчиков
  restartPolling(meterlist) {
    this.refreshMeterlist = true; // игнорировать последний результат
    this.prepare(meterlist);
    this.currentMeterIdx = 0;
    // sendNext будет после 'data' либо по checkResponse
  }

  // Для текущего счетчика отправить запрос на следующий показатель
  // Или переход к следующему счетчику
  sendNext() {
    let buf;
    let pollIdx = this.nextPollIdx(this.meterlist[this.currentMeterIdx].pollIdx);
    if (pollIdx < 0) {
      // Закончили с этим счетчиком
      this.nextMeter();
      buf = protocol.getOpenReq();
    } else {
      this.meterlist[this.currentMeterIdx].pollIdx = pollIdx;
      buf = this.pollArray[pollIdx].buf;
    }
    if (buf) this.sendToUnit(buf);
  }

  // Выбор следующего счетчика
  nextMeter() {
    this.currentMeterIdx = this.currentMeterIdx + 1 < this.meterlist.length ? this.currentMeterIdx + 1 : 0;
    this.meterlist[this.currentMeterIdx].pollIdx = -1;
  }

  // Выбор следующего канала для чтения
  // Проверить, что канал текущего счетчика должен читаться - r:1
  // И должен читаться в этом цикле - countdown = 0
  nextPollIdx(idx) {
    let next_idx = idx + 1;
    while (next_idx < this.pollArray.length) {
      return next_idx;
    }
    return -1;

    // return idx + 1 < this.pollArray.length ? idx + 1 : -1;
  }

  // Отправка запроса по TCP
  sendToUnit(buf) {
    try {
      if (this.stopped) return; // В процессе остановки
      if (!buf) throw { message: 'Empty buffer!' };
      if (!Buffer.isBuffer(buf)) throw { message: 'Buffer is not a Buffer!' };

      buf = protocol.addAddressAndCRC(buf, this.meterlist[this.currentMeterIdx]);
      this.plugin.log(String(this.currentMeterIdx + 1) + ' <= ' + buf.toString('hex'), 2);
      this.sendTime = Date.now();
      this.waiting = 1;
      this.client.write(buf);
    } catch (e) {
      this.plugin.log('ERROR: sendToUnit: ' + e.message + (buf ? ' Buffer:' + buf.toString('hex') : ''));
    }
  }

  // Обработка входящего сообщения (ответа) и отправка на сервер
  processIncomingMessage(buf) {
    if (!buf) return;
    this.plugin.log('=> ' + buf.toString('hex'), 2);
    try {
      protocol.checkIncomingMessage(buf);
      this.errors = 0;
      const data = this.readData(buf);
      if (data) {
        this.plugin.sendData(data);
        this.plugin.log('send data ' + util.inspect(data), 2);
      }
    } catch (e) {
      this.plugin.log('ERROR: processIncomingMessage ' + e.message);
    }
  }

  // Разбор входящего сообщения
  // Возвращает массив toSend для отправки серверу
  readData(buf) {
    const adr = protocol.parseAddress(buf);
    this.plugin.log('readData ' + buf.toString('hex') + ' Meter long address=' + adr, 2);

    if (!this.meterSet.has(adr)) throw { message: 'Not found meter with long address ' + adr };

    const idx = this.meterSet.get(adr);
    const meter = this.meterlist[idx];
    const pollIdx = meter.pollIdx;
    if (pollIdx >= 0) {
      const pollItem = this.pollArray[pollIdx];
      if (!pollItem) throw { message: 'Not found pollItem for index ' + pollIdx };

      const res = protocol.parsePollItemData(buf, pollItem, meter);

      if (!res || !Array.isArray(res))
        throw { message: 'parsePollItemData: Expected array, received: ' + util.inspect(res) };

      // [{chan:'U1', value:220}, ...]
      this.plugin.log('.parsePollItemData res=' + util.inspect(res));
      const ts = Date.now();
      const toSend = [];
      res.forEach(ritem => {
        if (meter.chans[ritem.chan]) {
          toSend.push({ ...ritem, ts, id: meter.chans[ritem.chan].id, parentname: meter.parentname });
        } else {
          this.plugin.log('Not found channel ' + ritem.chan + ' for ' + meter.parentname);
        }
      });
      return toSend;
    }
  }

  /** checkResponse
   * Запускается по таймеру раз в секунду
   *   1. Проверяет, что истекло время ответа (timeout)
   *   2. Если опрос не идет - запустить опрос следующего счетчика
   */
  checkResponse() {
    if (this.waiting && Date.now() - this.sendTime > this.timeout) {
      this.errors += 1;
      const errstr = this.host + ':' + this.port + ' Timeout error! Number of ERRORS = ' + this.errors;
      if (this.errors < 10) {
        this.plugin.log('ERROR: ' + errstr);
        this.waiting = false;
        this.nextMeter();
        this.sendNext();
      } else {
        this.processExit(99, 'ERROR: ' + errstr + '! STOP!');
      }
    }
  }

  processExit(code, text) {
    if (text) this.plugin.log(text);
    this.stopped = true;
    if (this.client) this.client.end();

    setTimeout(() => {
      process.exit(code);
    }, 300);
  }
}

module.exports = Agent;
