/**
 * agent.js
 * Последовательный опрос счетчиков
 * Для адресации используется длинный адрес (серийный номер счетчика)
 * Опрос через tcp клиент
 */

const util = require('util');
const net = require('net');

const meters = require('./meters'); // Объект уже инициализирован
const protocol = require('./protocol');

// const networkErrors = ['ESOCKETTIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH'];
// const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class Agent {
  constructor(plugin, params) {
    this.plugin = plugin;
    this.params = params;
    this.waiting = 0; // Флаг ожидания
    this.sendTime = 0; // Время отправки последнего запроса
  }

  run() {
    const host = this.params.host;
    const port = Number(this.params.port);
    this.timeout = this.params.timeout || 5000;
    this.polldelay = this.params.polldelay || 200; // Интервал между запросами
    this.plugin.log('Try connect to ' + host + ':' + port);

    this.client = net.createConnection({ host, port }, () => {
      this.plugin.log('TCP client connected to ' + host + ':' + port);
      this.plugin.sendWorkingState();
      this.startPolling();
    });

    this.client.on('data', data => {
      this.waiting = 0;
      // При обновлении каналов последний результат игнорируется - счетчика может уже не быть
      if (this.suspend) return;

      this.processIncomingMessage(data);
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

  // Старт опроса
  startPolling() {
    this.pollArray = protocol.createOnePollArray();
    // this.plugin.log('One meter POLL ARRAY:' + util.inspect(this.pollArray), 2);
    this.firstMeter = true;
    this.sendNext();
    setInterval(this.checkResponse.bind(this), 1000);
  }

  suspendPolling() {
    this.suspend = true;
  }

  // Вызывается при обновлении списка счетчиков - список в meters уже обновлен
  restartPolling() {
    this.suspend = false;
    this.firstMeter = true;
    this.refreshMeterlist = true; 
    // this.sendNext() Вызовет checkResponse
  }

  // Для текущего счетчика отправить запрос на следующий показатель
  // Или переход к следующему счетчику
  // Опрос каждого счетчика начинается с отправки запроса getOpenReq (пароль для подключения)
  // Далее отправляются запросы в соответствии с polls этого счетчика
  sendNext() {
    let buf;
    if (this.firstMeter) {
      this.firstMeter = false;
      meters.firstMeter();
      buf = protocol.getOpenReq();
    } else {
      let pollArrayIdx = meters.nextPollIdx();
      if (pollArrayIdx < 0) {
        meters.nextMeter();
        buf = protocol.getOpenReq();
      } else {
        buf = this.pollArray[pollArrayIdx].buf;
      }
    }
    if (buf) this.sendToUnit(buf);
  }

  // Отправка запроса по TCP
  sendToUnit(buf) {
    try {
      if (this.stopped) return; // В процессе остановки
      if (!buf) throw { message: 'Empty buffer!' };
      if (!Buffer.isBuffer(buf)) throw { message: 'Buffer is not a Buffer!' };

      const meter = meters.getCurrentMeter();
      buf = protocol.addAddressAndCRC(buf, meter);
      this.plugin.log(meter.parentname + ' <= ' + buf.toString('hex'), 2);
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
    try {
      protocol.checkIncomingMessage(buf);
      this.errors = 0;
      const data = this.readData(buf);
      if (data) {
        this.plugin.sendData(data);
        // this.plugin.log('send data ' + util.inspect(data), 2);
      }
    } catch (e) {
      this.plugin.log('ERROR: processIncomingMessage ' + buf.toString('hex') + e.message);
    }
  }

  // Разбор входящего сообщения
  // Возвращает массив для отправки серверу
  readData(buf) {
    const addr = protocol.parseAddress(buf);
    const meter = meters.getMeterByAdr(addr);
    if (!meter) throw { message: 'Not found meter with address ' + addr };

    this.plugin.log(meter.parentname + ' => ' + buf.toString('hex'), 2);
    const pollArrayIdx = meters.getCurrentPollArrayIdx(meter);

    if (pollArrayIdx >= 0) {
      const pollItem = this.pollArray[pollArrayIdx];
      if (!pollItem) throw { message: 'Not found pollItem for pollArrayIdx =  ' + pollArrayIdx };

      const res = protocol.parsePollItemData(buf, pollItem, meter);

      if (!res || !Array.isArray(res))
        throw { message: 'parsePollItemData: Expected array, received: ' + util.inspect(res) };

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
    if (this.suspend) return;
    if (this.refreshMeterlist) {
      this.refreshMeterlist = false;
      this.sendNext();
    }

    if (this.waiting && Date.now() - this.sendTime > this.timeout) {
      this.errors += 1;
      const errstr = ' Timeout error!';
      // const errstr = ' Timeout error! Number of ERRORS = ' + this.errors;
      if (this.errors < 10) {
        this.waiting = false;

        const meter = meters.getCurrentMeter();
        this.plugin.log('ERROR: ' + meter.parentname + errstr);
        const arr = this.getCurrentRemainingChannels(meter);
        this.sendChansWithBadChstatus(arr, meter);

        // Переход на следующий счетчик
        // TODO - нужен пароль для каждого счетчика!!
        meters.nextMeter();
        this.sendToUnit(protocol.getOpenReq());
      } else {
        this.processExit(99, 'ERROR: ' + errstr + ' Number of ERRORS = ' + this.errors + '! Stopped');
      }
    }
  }

  sendChansWithBadChstatus(chanArr, meter) {
    const toSend = [];
    try {
      if (chanArr.length) {
        const ts = Date.now();
        chanArr.forEach(ritem => {
          toSend.push({ ts, id: ritem.id, chan: ritem.chan, parentname: meter.parentname, chstatus: 1 });
        });
        this.plugin.sendData(toSend);
      }
    } catch (e) {
      this.plugin.log('ERROR:sendChansWithBadChstatus ' + util.inspect(e));
    }
  }

  /* Возвращает массив каналов, которые не были опрошены
   *
   * */
  getCurrentRemainingChannels(meter) {
    let next_idx = meter.pollIdx < 0 ? 0 : meter.pollIdx;
    try {
      const result = [];
      while (next_idx < meter.polls.length) {
        const pollItem = this.pollArray[meter.polls[next_idx].pollArrayIdx];
        if (pollItem) {
          if (pollItem.chan) {
            result.push(meter.chans[pollItem.chan]);
          } else if (pollItem.mid) {
            Object.keys(meter.chans).forEach(chan => {
              const chanItem = meter.chans[chan];
              if (chanItem.mid == pollItem.mid) result.push(chanItem);
            });
          }
        }
        next_idx += 1;
      }
      return result;
    } catch (e) {
      this.plugin.log('ERROR: getCurrentRemainingChannels ' + util.inspect(e));
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
