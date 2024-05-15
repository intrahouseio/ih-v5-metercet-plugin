/**
 * fakeMeter.js
 * Эмулятор счетчика СЭТ по TCP (server-slave)
 * - Слушает порт, отвечает на запросы
 */

const net = require('net');
// var util = require("util");

const protocol = require('./lib/protocol');

// const meterAdr = 0x53;
let meterAdr = 0;

serverStart(4001);

function serverStart(port) {
  const server = net.createServer(c => {
    c.setKeepAlive(true, 15000);

    // Отключить буферизацию при записи
    c.setNoDelay(true);

    /** Прием данных **/
    c.on('data', buf => {
      traceMsg('=> ' + buf.toString('hex'));

      if (!buf || buf.length < 4) {
        traceMsg('Invalid buffer!');
        return;
      }

      // Проверка CRC
      if (!protocol.checkCRC(buf)) {
        traceMsg('ERROR CRC!');
        return;
      }

      // Сообщения - по коду запроса: 00, 01, 08 - первый байт
      let result = getResponse(buf);

      // Ответ
      if (result) {
        sendResponse(result);
      }
    });

    /** Конец связи - получен FIN **/
    c.on('end', () => {
      traceMsg('Client disconnected (end)');
    });

    c.on('close', () => {
      traceMsg('Client is closed ');
    });

    c.on('error', () => {
      traceMsg('Client connection error ');
    });

    /** Передать ответ **/
    function sendResponse(buf) {
      if (buf) {
        // Посчитать CRC
        protocol.setCRC(buf);
        c.write(buf);
        traceMsg(' <= ' + buf.toString('hex'));
      }
    }
  });

  server.listen(port, () => {
    traceMsg('TCP server port:' + port + ' has bound.');
  });

  server.on('error', e => {
    let mes = e.code == 'EADDRINUSE' ? 'Address in use' : +e.code;
    traceMsg('TCP server port:' + port + ' error ' + e.errno + '. ' + mes);
    process.exit(1);
  });
}

function getResponse(abuf) {
  const longAddress = abuf.subarray(0, 5);
  console.log('longAddress '+longAddress.toString('hex'))

  // Адреса для тестирования:
  // 7 - счетчик не отвечает ни на один запрос
  const notAnsweredAdr =  Buffer.from([ 0xfc, 0, 0, 0, 0x7]);
  if (longAddress.compare(notAnsweredAdr) == 0) {
    console.log('notAnsweredAdr ');
    return;
  }

  // 5 - счетчик не отвечает на запрос 05 - учтенной энергии (E)
  const partialAnsweredAdr =  Buffer.from([ 0xfc, 0, 0, 0, 0x5]);
 
  const buf = abuf.subarray(5);
  console.log('buf '+buf.toString('hex'))

  let resbuf;
  // Сообщения - по коду запроса: 00, 01, 08 - первый байт
  switch (buf[0]) {
    // Проверка связи с нулевым адресом
    case 0x00:
      resbuf = Buffer.from([ 0x0, 0, 0]);
      break;

    // Запрос соединения с паролем
    case 0x01:
      console.log('PASSWORD')
      // Пароль не проверяется!!
      resbuf = Buffer.from([ 0x0, 0, 0]);
      break;

    // Чтение массивов учтенной энергии
    case 0x05:
      console.log('response05')
      if (longAddress.compare(partialAnsweredAdr) == 0) {
        console.log('partialAnsweredAdr');
        return;
      }
      resbuf = response05(buf);
      break;

    // Другое чтение
    case 0x08:
      console.log('response08')
      resbuf = response08(buf);
      break;

    // Ответ - Недопустимая команда
    default:
      console.log('Недопустимая команда')
      resbuf = Buffer.from([ 0x01, 0, 0]);
      break;
  }
  return Buffer.concat([longAddress, resbuf]);
}

// Код команды=05, номер массива - байт №2, номер тарифа - байт №3
// Возвращает A+ A- R+ R-
function response05(buf) {

  let tarif = buf[1];
  console.log('Tarif=' + tarif);
  //
  return Buffer.from([0, 0x00, 0x00, 0x27, 0x11, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x13, 0x89, 0x0, 0x0, 0x0, 0x65, 0, 0]);
}

// Код команды=08, код параметра - байт №2
function response08(buf) {
  switch (buf[1]) {
    // Чтение серийного номера 1-4 байты и даты выпуска 5-7 байты
    case 0x00:
      return Buffer.from([0x2f, 0xfe, 0x19, 0x57, 0x17, 0x05, 0x18, 0, 0]);

    // Запрос температуры = 35 = 23h
    case 0x01:
      return Buffer.from([0x00, 0x23, 0, 0]);
    // return Buffer.from([ 0x01, 0, 0]); // Неверная команда - для отладки

    // Чтение коэф-тов трансформации
    case 0x02:
      return Buffer.from([ 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0, 0]);

    // Чтение сетевого адреса
    case 0x05:
      meterAdr = 0x53;
      return Buffer.from([ 0x00, meterAdr, 0, 0]);

    // Чтение расширенных значений для 4ТМ02 - 3 байта
    case 0x11:
      return response0811(buf);

    // Чтение варианта исполнения счетчика
    case 0x12:
      return Buffer.from([ 0x64, 0x42, 0, 0]);

    // Чтение расширенных значений с плавающей точкой
    case 0x1b:
      if (buf[2] == 0x02) return response081b02(buf);
      // if (buf[3] == 0x02) return response081b02(buf);
      break;

    default:
  }
}

function response0811(buf) {
  switch (buf[2]) {
    // Активная мощность
    case 0x00: // по сумме фаз
    case 0x01: // по фазе 1
    case 0x02: // по фазе 2
    case 0x03: // по фазе 3
      // read3Byte - выполняется маскирование 2 старших битов: 0x44=>0x04!!!
      return Buffer.from([ 0x44, 0x2f, 0x47, 0, 0]); // = 274241/1000 = 274.241 Watt
    // Реактивная мощность
    case 0x04:
    case 0x05:
    case 0x06:
    case 0x07:
      return Buffer.from([ 0x44, 0x2f, 0x47, 0, 0]); // 274.241 Watt

    // Полная мощность
    case 0x08:
    case 0x09:
    case 0x0a:
    case 0x0b:
      return Buffer.from([ 0x44, 0x2f, 0x47, 0, 0]); // 274.241 Watt

    // Напряжение
    case 0x11:
      // fc 304aacb4 005d0a 7e0c
      return Buffer.from([ 0x00, 0x5d, 0x0a, 0, 0]); // 23818 = 238,18 V

    case 0x12:
    case 0x13:
      return Buffer.from([ 0x00, 0x55, 0xf0, 0, 0]); // 22000 = 220 V

    // Ток
    case 0x21:
    case 0x22:
    case 0x23:
      return Buffer.from([ 0x00, 0x00, 0x58, 0, 0]); // 88/10 = 8.8 мА= 0.0088 А

    // cos
    case 0x30:
    case 0x31:
    case 0x32:
    case 0x33:
      return Buffer.from([ 0x00, 0x00, 0x16, 0, 0]); // 22/100 = 0.22

    // Частота
    case 0x40:
      return Buffer.from([ 0x80, 0x13, 0x88, 0, 0]); // 5000 = 50 гц (ст бит уст - его сбросить!!)

    // Kuf
    case 0x80:
    case 0x81:
    case 0x82:
    case 0x83:
      return Buffer.from([ 0x40, 0x00, 0x21, 0, 0]); // 33/100 = 0.33 (ст бит уст - его сбросить!!)

    default:
  }
}

// Чтение расширенных значений с плавающей точкой. 3 байт=02 Групповые данные(стр 183)
// 4 байт  (RWRI - регистр вспомогательных режимов измерения)
//  Старший полубайт определяет конкретный параметр 0-f
//  Младший полубайт - номер фазы +иногда номер параметра (стр 161)
// Возращается 4 значения с плавающей точкой (возможно, все одинаковые, как для частоты сети)
function response081b02(buf) {
  switch (buf[3]) {
    // Активная мощность по всем фазам
    case 0x00:
      return Buffer.from([
       
        0x57,
        0x49,
        0x3f,
        0x40,
        0x0,
        0x0,
        0x0,
        0x0,
        0x0,
        0x0,
        0x0,
        0x0,
        0x57,
        0x49,
        0x3f,
        0x40,
        0,
        0
      ]);

    // Реактивная мощность по всем фазам
    case 0x04:
      return Buffer.from([
       
        0xd7,
        0x3a,
        0xc4,
        0x41,
        0xe8,
        0x6f,
        0xbd,
        0x41,
        0xc6,
        0xa8,
        0xda,
        0x42,
        0x0a,
        0xf6,
        0xd8,
        0xc2,
        0,
        0
      ]);

    // Полная мощность по всем фазам
    case 0x08:
      return Buffer.from([
       
        0xfe,
        0x5d,
        0x04,
        0x43,
        0xb8,
        0xd9,
        0x9a,
        0x42,
        0x55,
        0x44,
        0xdc,
        0x42,
        0xcc,
        0x87,
        0x9c,
        0x42,
        0,
        0
      ]);

    // Фазное напряжение
    case 0x10:
      return Buffer.from([
       
        0x07,
        0x87,
        0x5b,
        0x43,
        0x07,
        0x87,
        0x5b,
        0x43,
        0xec,
        0xcf,
        0x60,
        0x43,
        0x03,
        0x1d,
        0x64,
        0x43,
        0,
        0
      ]);

    // Ток
    case 0x20:
      return Buffer.from([
       
        0x08,
        0x74,
        0xa7,
        0x3d,
        0x08,
        0x74,
        0xa7,
        0x3d,
        0x0,
        0x0,
        0x0,
        0x0,
        0x0,
        0x0,
        0x0,
        0x0,
        0,
        0
      ]);

    // Коэф-т активной мощности  cos phi
    case 0x30:
      return Buffer.from([
      
        0x27,
        0x8b,
        0x24,
        0x3f,
        0xf8,
        0x9a,
        0xaa,
        0x3e,
        0x30,
        0x60,
        0xd1,
        0x3e,
        0x7c,
        0xc8,
        0x8f,
        0x3e,
        0,
        0
      ]);

    // Коэф-т искажения фазного напряжения %
    case 0x80:
      return Buffer.from([
       
        0x11,
        0x13,
        0x94,
        0x40,
        0x11,
        0x13,
        0x94,
        0x40,
        0xc8,
        0x0f,
        0x9a,
        0x40,
        0x54,
        0xac,
        0x93,
        0x40,
        0,
        0
      ]);

    // Частота сети
    case 0x40:
      return Buffer.from([
      
        0x53,
        0x02,
        0x48,
        0x42,
        0x53,
        0x02,
        0x48,
        0x42,
        0x53,
        0x02,
        0x48,
        0x42,
        0x53,
        0x02,
        0x48,
        0x42,
        0,
        0
      ]);

    // Недопустимая команда
    default:
      return Buffer.from([0, 0x01, 0, 0]);
  }
}

function traceMsg(txt) {
  console.log(txt);
}

// 25.04 17:18:32.167 metercetmlt1: <= fc304aacb40811118b05
// 25.04 17:18:32.205 metercetmlt1: => fc304aacb4005d0a7e0c
//                                     fc2fedcb050055f5dcae
// 25.04 17:18:32.206 IH: get [ { id: 'U1', value: 238.18 } ]
