/**
 * Функции разбора и формирования данных по протоколу счетчика СЭТ-4ТМ
 *  на основе документации производителя:
 *
 *  Протокол обмена счетчиков серии СЭТ-4ТМ Редакция 6.6.27 от 18.09.2017
 */

 // Структура сообщений при использовании длинного адреса (серийного номера счетчика)
// 0 байт=252 (fc)
// 1-4 байты содержат серийный номер - целое число BE
// 0b 1-4b
// fc 0000006f 0811225f85


// const util = require('util');

exports.setCRC = setCRC;
exports.checkCRC = checkCRC;
exports.addAddressAndCRC = addAddressAndCRC;
exports.checkIncomingMessage = checkIncomingMessage;

exports.getFirstReq = getFirstReq;
exports.getAddressReq = getAddressReq;
exports.getOpenReq = getOpenReq;
exports.getServiceReq = getServiceReq;
exports.getErrorTxt = getErrorTxt;
// exports.getMeteringReq = getMeteringReq;

exports.readServiceMessage = readServiceMessage;
exports.read4Energy = read4Energy;
// exports.readData = readData;

exports.nameOfServiceProp = nameOfServiceProp;
exports.createPollArray = createPollArray;
exports.createOnePollArray = createOnePollArray;

exports.parsePollItemData = parsePollItemData;
exports.parseAddress = parseAddress;

/**
 * Функции, формирующие запросы (get)
 *
 * Возвращают Buffer, в который подставлены два последних байта для контрольной суммы
 * Если элемент представлен как 0x0 - это константа, как 0 - элемент будет заменен (1 байт - адрес, 2 последних - CRC)
 *
 * Функции разбора входящих сообщений (read)
 *  Возвращают объект или массив объектов
 */

// Первый запрос - тестирование связи - передается 0 по 0 адресу
// В ответе (первый байт) получим адрес - только для 03, 02 возвращает 0
function getFirstReq() {
  return Buffer.from([0x0, 0x0, 0, 0]);
}

// Запрос на получение адреса
// Счетчик 02 не возвращает адрес при тестировании связи getFirstReq, поэтому пробуем так
function getAddressReq(longAdr) {
  const priznak = longAdr ? 1 : 0;
  return Buffer.from([0x0, 0x08, 0x05, priznak, 0, 0]);
}

// Запрос на открытие канала - передается пароль - 6 символов
// Пример для счетчика в адресом 53 и паролем по умолчанию
// <= 53 01 30 30 30 30 30 30 4B 0D
// => 53 00 3D 40 - OK
function getOpenReq(password) {
  if (!password) password = '000000'; // 0x30,0x30,..
  return Buffer.concat([Buffer.from([0, 0x1]), Buffer.from(password), Buffer.from([0, 0])]);
}

// Запросы на чтение параметров (сервисные запросы)
function getServiceReq(nReq) {
  // nReq = 1;
  switch (nReq) {
    // Чтение серийного номера
    case 1:
      return Buffer.from([0, 0x8, 0x0, 0, 0]);

    // Чтение коэффициентов трансформации для счетчика
    case 2:
      return Buffer.from([0, 0x8, 0x2, 0, 0]);

    // Чтение варианта исполнения (постоянная счетчика)
    case 3:
      return Buffer.from([0, 0x8, 0x12, 0, 0]);

    default:
  }
}

// Чтение ответов на сервисные запросы
// Все примеры для счетчика с адресом 53 и включая CRC
function readServiceMessage(serviceReq, buf) {
  if (!buf || !Buffer.isBuffer(buf)) return;

  if (buf[0] == 252) buf = buf.slice(4);

  let robj = 'serviceReq ' + serviceReq;
  switch (serviceReq) {
    // 1. Чтение серийного номера, код параметра 00
    //  <= 53 08 00 86 11
    // Возвращает 7 байт в поле данных (+1 байт адрес +2 CRC) = 10
    //  => 53 2F FE 19 57 17 05 18 70 D6
    // 1-4 байт - серийный номер счетчика в двоичном виде
    // 5-7 байт - дата выпуска в двоично/десятичном виде: число, месяц, год
    case 1:
      if (buf.length == 10) {
        robj = {
          snumber: buf.readUInt32BE(1)
        };
        /* Двоично - дестичный вид - это по тетрадам!!
        robj = {
            snumber: buf.readUInt32BE(1),
            product_date:
              pad(buf[5], 2) + "-" + pad(buf[6], 2) + "-" + String(2000 + buf[7])
          };
        */
      }
      break;

    // 2. Чтение коэффициентов трансформации, код параметра 02h
    //  <= 53 08 02 07 D0
    // Возвращает 10 байт в поле данных (+1 байт адрес +2 CRC) = 13
    //  => 53 00 01 00 01 00 00 00 00 00 00 15 F1
    // 1-2 байт - коэф трансформ по напряжению
    // 3-4 байт - коэф трансформ по току
    // 5 байт: 0- кВт, 1 - мВт
    // 6-10 - Текущий коэф-т трансформации, для счетчиков СЭТ-4ТМ.03 возвращают нули
    case 2:
      if (buf.length == 13) {
        robj = { ktu: buf.readUInt16BE(1), kti: buf.readUInt16BE(3) };
      }
      break;

    // 3. Чтение варианта исполнения, код параметра 12h (п2.4.3.26)
    //  <= 53 08 12 06 1C
    // Возвращает 3 байт в поле данных (+1 байт адрес +2 CRC) = 6
    //  => 53 64 42 80 61 BF
    // 1 байт
    //  0-1 бит Номинальный ток: 0 - 5A, 1 - 1A, 2 - 10A
    //  2-3 бит Номинальное напряжение: 0 - 57.7, 1 - 120-230 В
    //  4-5 бит Класс точности по реактивной энергии: 0 - 3
    //  6-7 бит Класс точности по активной энергии: 0 - 3
    // 2 байт
    //  0-3 бит Постоянная счетчика, имп/квт*ч: 0 - 5000, 1 - 2500, 2 - 1250, 3 - 6250, 4 - 500, 5 - 250, 6 - 6400
    //  4-5 бит Число фаз счетчика: 0 - 3 фазы, 1 - 1 фаза
    //  6   бит Температурный диапазон 0 - 20 гр, 1 - 40 гр
    //  7   бит Число направлений: 0 - 2 направления, 1 - одно
    // 3 байт - РАЗЛИЧНЫЕ ДАННЫЕ для разных счетчиков
    //      Здесь для СЭТ-4ТМ.03 СЭТ-4ТМ.03М
    //  0 бит Кол-во интерфейсов RS-485: 0 - два, 1 - один
    //  1 бит Резервный источник: 0 - есть, 1 - нет
    //  2-3 бит нули
    //  4-7 бит тип счетчика: 01h - СЭТ-4ТМ.03, 08h - СЭТ-4ТМ.03M

    // Пока беру только постоянную счетчика!
    case 3:
      robj = { constant: meterConstant(buf[2] & 0x0f) };

      break;

    default:
  }
  return robj;
}

function meterConstant(val) {
  switch (val) {
    case 0:
      return 5000;
    case 1:
      return 2500;
    case 2:
      return 1250;
    case 3:
      return 6250;
    case 4:
      return 500;
    case 5:
      return 250;
    case 6:
      return 6400;
    default:
      return 0;
  }
}

function nameOfServiceProp(prop) {
  switch (prop) {
    case 'ktu':
      return 'Коэффициент трансформации по напряжению';
    case 'kti':
      return 'Коэффициент трансформации по току';
    case 'snumber':
      return 'Серийный номер счетчика';
    case 'product_date':
      return 'Дата выпуска';
    default:
      return '';
  }
}




function read3ByteValue(buf, pollItem, assets) {
  const int32Buf = Buffer.from([0, 0, 0, 0]);
  int32Buf[1] = buf[0] & 0x3f; // Маскировать 2 старших бита
  int32Buf[2] = buf[1];
  int32Buf[3] = buf[2];

  const value = calculate3ByteValue(pollItem.mid, int32Buf.readUInt32BE(0), assets);
  return [{ chan: pollItem.chan, value }];
}

// стр 159
function calculate3ByteValue(mid, val, { kti, ktu, ks }) {
  // console.log('calculate3ByteValue mid='+mid+' val='+val)
  // const ks = 2; // для датчиков 02, 03 и напр 120-230 = 2
  let result;
  switch (mid) {
    case 'P':
    case 'Q':
    case 'S':
      result = val * kti * ktu * ks * 0.001; // V
      break;

    case 'U':
      result = val * ktu * 0.01; // V
      break;

    case 'I':
      result = val * kti * 0.0001; // A
      break;

    case 'f':
      result = val * 0.01; // Гц
      break;

    case 'cos':
      result = val * 0.01;
      break;

    case 'Kuf':
      result = val * 0.01; // %
      break;

    default:
      result = val;
  }
  return round(result);
}

// Чтение массивов учтенной энергии по тарифам: A+ A- R+ R-
function read4Energy(buf, pollItem, assets) {
  const res = [];
  const kt = assets.kt || 1;

  const tstr = '';
  let sut = '';

  if (buf.length < 15) return [];

  res.push(buf.readUInt32BE(0) * kt);
  res.push(buf.readUInt32BE(4) * kt);
  res.push(buf.readUInt32BE(8) * kt);
  res.push(buf.readUInt32BE(12) * kt);

  return [
    { chan: 'EAP' + sut + tstr, value: round(res[0]) },
    { chan: 'EAM' + sut + tstr, value: round(res[1]) },
    { chan: 'ERP' + sut + tstr, value: round(res[2]) },
    { chan: 'ERM' + sut + tstr, value: round(res[3]) }
  ];
}

function read4Float(buf, pollItem) {
  let mid = pollItem.mid;
  let res = [];
  res.push(buf.readFloatLE(0));
  res.push(buf.readFloatLE(4));
  res.push(buf.readFloatLE(8));
  res.push(buf.readFloatLE(12));
  return res.map((val, idx) => ({ chan: mid + String(idx), value: round(val) }));
}



function read1Uint16(buf, pollItem) {
  let mid = pollItem.mid;
  let res = [];
  res.push(buf.readUInt16BE(0));
  return res.map(val => ({ chan: mid, value: round(val) }));
}

function round(val) {
  return Math.round(val * 1000) / 1000;
}

function setCRC(buf) {
  return buf && Buffer.isBuffer(buf) ? buf.writeUInt16LE(crc16(buf, buf.length - 2), buf.length - 2) : '';
}

function checkCRC(buf) {
  if (buf && Buffer.isBuffer(buf)) {
    return buf.readUInt16LE(buf.length - 2) == crc16(buf, buf.length - 2);
  }
}
/**
 * Calculates the buffers CRC16.
 *
 * @param {Buffer} buffer the data buffer.
 * @return {number} the calculated CRC16.
 */
function crc16(buffer, len) {
  let crc = 0xffff;
  let odd;
  if (!len) len = buffer.length;

  for (let i = 0; i < len; i++) {
    crc ^= buffer[i];

    for (let j = 0; j < 8; j++) {
      odd = crc & 0x0001;
      crc >>= 1;
      if (odd) {
        crc ^= 0xa001;
      }
    }
  }

  return crc;
}

function addAddressAndCRC(buf, meterlistItem) {
  const dec = meterlistItem.longadr;
  const longAddress = Buffer.allocUnsafe(5);
  longAddress[0] = 252;
  longAddress.writeUIntBE(dec, 1, 4);
  buf = Buffer.concat([longAddress, buf.slice(1)]);
  setCRC(buf);
  return buf;
}

function checkIncomingMessage(buf) {
  if (buf.length < 4) throw { message: 'Invalid  message length! Skipped. Buffer:' + buf.toString('hex') };

  if (!checkCRC(buf)) {
    let message = 'CRC ERROR! Buffer: ' + buf.toString('hex') + '\n';
    setCRC(buf);
    message += 'Expected Buffer:' + buf.toString('hex');
    throw { message };
  }

  // Можем получить 4 байта или больше Если 4 байта - м б ошибка!!
  if (buf.length == 4) {
    // Считать байт состояния обмена - д б 0
    if (buf[1] > 0) throw { message: getErrorTxt(buf[1]) };
  }
}

function createPollArray(midObj, ntariffs) {
  let res = [];

  // {mid, <chan, tarif,> buf, readfn, count }
  Object.keys(midObj).forEach(mid => {
    res.push(...getPollItems(mid, midObj[mid], ntariffs));
  });
  return res;
}

function createOnePollArray(arr) {
  let res = [];

  // {mid, <chan, tarif,> buf, readfn, count }
  arr.forEach(item => {
    res.push(...getPollItems(item.mid));
  });
  return res;
}

function parsePollItemData(buf, pollItem, meter) {
  const dataBuf = buf.slice(5);
  return pollItem.readfn(dataBuf, pollItem, meter.assets);
}

function getPollItems(mid, period, ntariffs) {
  switch (mid) {
    // Чтение массивов учтенной энергии по тарифам - всего от сброса = 0
    case 'E':
      /*
      return [{
        mid,
        buf: Buffer.from([0, 0x8, 0xD, 0, 0]),
        readfn: read4Energy,
        count:0
      }];
      */
      return getReq05(ntariffs, period, mid); // всего от сброса = 0
    /*
    case "ES":
      return getReq05(ntariffs, period, mid); // за текущие сутки

    case "EX":
      return getReq0A(ntariffs, period, mid); // на начало текущего месяца - расширенный запрос
    */

    // Чтение данных вспомогательных режимов
    case 'I':
    case 'U':
      return getReq11(mid, period, ['1', '2', '3']);

    case 'F':
      return getReq11(mid, period, ['0']);

    case 'P':
    case 'Q':
    case 'S':
    case 'cos':
    case 'Kuf':
      return getReq11(mid, period, ['0', '1', '2', '3']);

    // Чтение температуры
    case 'T':
      return getOneUintValue(mid, period);

    default:
      throw { message: 'getPollItems: Unknown mid = ' + mid };
  }
}

function getReq1b02(mid, count) {
  return [
    {
      mid,
      buf: Buffer.from([0, 0x8, 0x1b, 0x02, getRWRI(mid, 0), 0, 0]),
      readfn: read4Float,
      count
    }
  ];
}

function getReq11(mid, count, arr) {
  return arr.map(item => ({
    mid,
    buf: Buffer.from([0, 0x8, 0x11, getRWRI(mid, item), 0, 0]),
    chan: arr.length > 1 ? mid + item : mid,
    readfn: read3ByteValue,
    count
  }));
}

// стр 156 табл 2-40
function getRWRI(mid, phase) {
  phase = Number(phase);
  switch (mid) {
    case 'P':
      return 0x00 + phase;
    case 'Q':
      return 0x04 + phase;
    case 'S':
      return 0x08 + phase;
    case 'U':
      return 0x10 + phase;
    case 'I':
      return 0x20 + phase;
    case 'cos':
      return 0x30 + phase;
    case 'f':
      return 0x40;
    case 'Kuf':
      return 0x80 + phase;
    default:
      return 0;
  }
}

// Чтение массивов учтенной энергии по тарифам Стр 116
function getReq05(ntariffs = 1, count, mid) {
  // 1 байт - код запроса 05h
  // 2 байт - старший полубайт
  //    Энергия от сброса - нарастающий итог =0
  //    Энергия за текущие сутки 04h
  //    Энергия за предыдущие сутки 05h
  // 2 байт - мл полубайт - номер месяца =0
  // 3 байт - номер тарифа 1-8, 0 = по всем тарифам

  if (ntariffs <= 1) ntariffs = 0;
  // Если тариф 1 - то только по всем тарифам??

  let byte2 = mid == 'ES' ? 0x40 : 0x00;
  let res = [];
  // for (let t = 0; t <= ntariffs; t++) {
  res.push({
    mid,
    buf: Buffer.from([0, 0x5, byte2, 0, 0, 0]),
    readfn: read4Energy,
    count
  });
  // }
  return res;
}

// Энергия на начало тек м-ца  Стр 115
function getReq0A(ntariffs, count, mid) {
  // 1 байт - код запроса 0Ah
  // 2 байт - 83h - Энергия на начало м-ца

  // 3 байт - мл полубайт - номер месяца =11
  // 4 байт - номер тарифа 1-8, 0 = по всем тарифам

  if (ntariffs <= 1) ntariffs = 0;

  let res = [];
  res.push({
    mid,
    tarif: 0,
    buf: Buffer.from([0, 0xa, 0x83, 0xb, 0x0, 0xf, 0x0, 0, 0]),
    readfn: read4Energy,
    count
  });

  return res;
}

// стр 124 п 2.4.3.2
function getOneUintValue(mid, count) {
  return [
    {
      mid,
      buf: Buffer.from([0, 0x08, 0x01, 0, 0]),
      readfn: read1Uint16,
      count
    }
  ];
}

function parseAddress(buf) {
  if (buf.size<5) throw {messsage:'parseAddress: Expected buffer with long address (5 byte), received bytes: '+buf.size}
  return buf.readUInt32BE(1); // Нулевой байт = 252 (fc), далее 4 байта адрес
}

// Значения байта обмена состояния. Интерпретация стр 16 Таблица 1-2
function getErrorTxt(byte) {
  switch (byte) {
    case 0x00:
      return 'OK';
    case 0x01:
      return 'Недопустимая команда или параметр';
    case 0x02:
      return 'Внутренняя ошибка счетчика';
    case 0x03:
      return 'Недостаточен уровень доступа';
    case 0x04:
      return 'Внутренние часы уже корректировались в течение текущих суток';
    case 0x05:
      return 'Не открыт канал связи';
    case 0x06:
      return 'Повторить запрос в течение 0.5 сек';
    case 0x07:
      return 'Не готов результат измерения или Нет данных по запрашиваемому параметру';
    case 0x08:
      return 'Счетчик занят';
    default:
      return 'Не распознанная ошибка. Байт состояния=' + byte.toString(16);
  }
}
 