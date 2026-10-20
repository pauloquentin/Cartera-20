// CARTERA 20 — Motor de datos de mercado
// Cálculos y normalización de datos de mercado, independientes de la fuente.

function normalizarNumeroMercado(valor) {
  if (typeof valor === 'number') return valor;
  let texto = String(valor ?? '').trim().replace(/^"|"$/g, '').replace(/\$/g, '').trim();
  if (!texto) return NaN;

  if (texto.includes('.') && texto.includes(',')) {
    texto = texto.lastIndexOf(',') > texto.lastIndexOf('.')
      ? texto.replace(/\./g, '').replace(',', '.')
      : texto.replace(/,/g, '');
  } else if (texto.includes(',')) {
    texto = texto.replace(',', '.');
  }

  return Number(texto);
}

/**
 * Divide una línea CSV respetando campos entre comillas.
 */
function dividirCSV(linea) {
  const partes = [];
  let actual = '';
  let entreComillas = false;

  for (let i = 0; i < linea.length; i += 1) {
    const caracter = linea[i];

    if (caracter === '"') {
      if (entreComillas && linea[i + 1] === '"') {
        actual += '"';
        i += 1;
      } else {
        entreComillas = !entreComillas;
      }
      continue;
    }

    if (caracter === ',' && !entreComillas) {
      partes.push(actual.trim());
      actual = '';
      continue;
    }

    actual += caracter;
  }

  partes.push(actual.trim());
  return partes;
}

function convertirFechaGoogle(valor) {
  const texto = String(valor ?? '').trim().replace(/^"|"$/g, '');
  const match = texto.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+)(?:,(\d+))?)?\)$/);

  if (!match) return texto;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);
  const second = Number(match[6] || 0);

  return new Date(year, month, day, hour, minute, second).toISOString();
}

/**
 * Convierte datos copiados desde Google Sheets / Google Finance
 * en una serie uniforme de fecha + cierre.
 * Acepta texto tabulado, CSV y valores Date() de Google Visualization.
 */
function parsearHistoricoGoogleSheets(texto) {
  if (typeof texto !== 'string') return [];

  return texto
    .split(/\r?\n/)
    .map(linea => linea.trim())
    .filter(Boolean)
    .map(linea => {
      const fechaGoogle = linea.match(/^\"?(Date\([^)]*\))\"?\s*,\s*(.+)$/);
      let date = '';
      let closeTexto = '';

      if (fechaGoogle) {
        date = convertirFechaGoogle(fechaGoogle[1]);
        closeTexto = fechaGoogle[2].trim();
      } else {
        const partes = linea.includes('\t')
          ? linea.split('\t').map(p => p.trim())
          : linea.includes(';')
            ? linea.split(';').map(p => p.trim())
            : dividirCSV(linea);

        if (partes.length < 2) return null;

        date = convertirFechaGoogle(partes[0]);
        closeTexto = partes[partes.length - 1];
      }

      const close = normalizarNumeroMercado(closeTexto);
      return Number.isFinite(close) && close > 0
        ? { date, close }
        : null;
    })
    .filter(Boolean);
}

/**
 * Parsea la respuesta JSON de Google Visualization (GViz).
 * Es la ruta principal del proveedor porque evita depender del formato CSV.
 */
function parsearRespuestaGviz(texto) {
  if (typeof texto !== 'string' || !texto.trim()) return [];

  const inicio = texto.indexOf('{');
  const fin = texto.lastIndexOf('}');
  if (inicio === -1 || fin === -1 || fin <= inicio) return [];

  let payload;
  try {
    payload = JSON.parse(texto.slice(inicio, fin + 1));
  } catch (error) {
    return [];
  }

  const filas = payload?.table?.rows;
  if (!Array.isArray(filas)) return [];

  return filas
    .map(fila => {
      const celdas = Array.isArray(fila?.c) ? fila.c : [];
      const fecha = celdas[0]?.v ?? celdas[0]?.f ?? '';
      const cierre = celdas[1]?.v ?? celdas[1]?.f ?? '';
      const close = normalizarNumeroMercado(cierre);

      if (!fecha || !Number.isFinite(close) || close <= 0) return null;

      return {
        date: convertirFechaGoogle(fecha),
        close
      };
    })
    .filter(Boolean);
}

/**
 * Calcula el RSI-14 mediante el suavizado de Wilder.
 */
function calcularRSI(historicos) {
  if (!Array.isArray(historicos) || historicos.length < 15) {
    return { value: null, date: null, periods: 0, status: 'insufficient-data' };
  }

  const datos = historicos
    .map(item => ({ date: item.date, close: Number(item.close) }))
    .filter(item => Number.isFinite(item.close) && item.close > 0);

  if (datos.length < 15) {
    return { value: null, date: null, periods: datos.length, status: 'insufficient-data' };
  }

  let gainSum = 0;
  let lossSum = 0;

  for (let i = 1; i <= 14; i += 1) {
    const change = datos[i].close - datos[i - 1].close;
    gainSum += Math.max(change, 0);
    lossSum += Math.max(-change, 0);
  }

  let averageGain = gainSum / 14;
  let averageLoss = lossSum / 14;
  let rsi = averageLoss === 0 ? 100 : 100 - (100 / (1 + (averageGain / averageLoss)));

  for (let i = 15; i < datos.length; i += 1) {
    const change = datos[i].close - datos[i - 1].close;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    averageGain = ((averageGain * 13) + gain) / 14;
    averageLoss = ((averageLoss * 13) + loss) / 14;
    rsi = averageLoss === 0 ? 100 : 100 - (100 / (1 + (averageGain / averageLoss)));
  }

  return {
    value: rsi,
    date: datos[datos.length - 1].date,
    periods: datos.length - 1,
    status: 'ok'
  };
}

function crearProveedorMercado(provider) {
  if (!provider || typeof provider !== 'object') throw new Error('Proveedor de mercado inválido.');
  if (typeof provider.getQuote !== 'function') throw new Error('El proveedor debe implementar getQuote(ticker).');
  if (typeof provider.getHistory !== 'function') throw new Error('El proveedor debe implementar getHistory(ticker).');

  return {
    name: provider.name || 'Proveedor sin nombre',
    getQuote: provider.getQuote,
    getHistory: provider.getHistory
  };
}

/**
 * Proveedor Google Sheets / Google Finance.
 * Un solo proveedor sirve para cualquier cantidad de tickers.
 */
function crearProveedorGoogleSheets(config) {
  const opciones = config && typeof config === 'object' ? config : {};
  const spreadsheetId = String(opciones.spreadsheetId || '').trim();
  const sheetByTicker = opciones.sheetByTicker && typeof opciones.sheetByTicker === 'object'
    ? opciones.sheetByTicker
    : {};
  const historicosPorTicker = opciones.historicosPorTicker && typeof opciones.historicosPorTicker === 'object'
    ? opciones.historicosPorTicker
    : {};

  const nombrePestana = ticker => String(sheetByTicker[ticker] || ticker).trim();

  const construirUrl = ticker => {
    if (!spreadsheetId) throw new Error('Falta el ID del Google Sheet.');
    const sheet = encodeURIComponent(nombrePestana(ticker));
    const query = encodeURIComponent('select A, B where A is not null order by A');
    return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/gviz/tq?sheet=${sheet}&tqx=out:json&tq=${query}`;
  };

  const cargarHistorico = async ticker => {
    const precargado = historicosPorTicker[ticker];
    if (typeof precargado === 'string' && precargado.trim()) {
      return parsearHistoricoGoogleSheets(precargado);
    }

    const response = await fetch(construirUrl(ticker), { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`No se pudo consultar Google Sheets (${response.status}).`);
    }

    const texto = await response.text();
    const historico = parsearRespuestaGviz(texto);

    if (!historico.length) {
      throw new Error(`Google Sheets respondió, pero no hay cierres válidos para ${ticker} en la pestaña ${nombrePestana(ticker)}.`);
    }

    return historico;
  };

  return crearProveedorMercado({
    name: 'Google Sheets / Google Finance',

    async getHistory(ticker) {
      const historico = await cargarHistorico(ticker);
      return { ticker, data: historico, source: 'Google Sheets / Google Finance' };
    },

    async getQuote(ticker) {
      const historico = await cargarHistorico(ticker);
      const ultimo = historico[historico.length - 1] || null;
      return {
        ticker,
        price: ultimo ? ultimo.close : null,
        currency: 'ARS',
        date: ultimo ? ultimo.date : null,
        source: 'Google Sheets / Google Finance'
      };
    }
  });
}

window.Cartera20MarketData = {
  normalizarNumeroMercado,
  parsearHistoricoGoogleSheets,
  parsearRespuestaGviz,
  calcularRSI,
  crearProveedorMercado,
  crearProveedorGoogleSheets
};