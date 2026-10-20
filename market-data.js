// CARTERA 20 — Motor de datos de mercado
// Cálculos y normalización de datos de mercado, independientes de la fuente.

/**
 * Convierte datos copiados desde Google Sheets / Google Finance
 * en una serie uniforme de fecha + cierre.
 *
 * @param {string} texto
 * @returns {Array<{date:string, close:number}>}
 */
function parsearHistoricoGoogleSheets(texto) {
  if (typeof texto !== 'string') return [];

  return texto
    .split(/\r?\n/)
    .map(linea => linea.trim())
    .filter(Boolean)
    .map(linea => {
      const partes = linea.split(/\t|;|,/).map(p => p.trim());
      if (partes.length < 2) return null;

      const date = partes[0];
      let closeTexto = partes[partes.length - 1]
        .replace(/\$/g, '')
        .trim();

      if (closeTexto.includes('.') && closeTexto.includes(',')) {
        closeTexto = closeTexto.lastIndexOf(',') > closeTexto.lastIndexOf('.')
          ? closeTexto.replace(/\./g, '').replace(',', '.')
          : closeTexto.replace(/,/g, '');
      } else if (closeTexto.includes(',')) {
        closeTexto = closeTexto.replace(',', '.');
      }

      const close = Number(closeTexto);
      return Number.isFinite(close) && close > 0
        ? { date, close }
        : null;
    })
    .filter(Boolean);
}

/**
 * Calcula el RSI-14 mediante el suavizado de Wilder.
 *
 * @param {Array<{date:string, close:number}>} historicos
 * @returns {{value:number|null, date:string|null, periods:number, status:string}}
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

/**
 * Crea un proveedor de mercado con una interfaz estable.
 */
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
 * Crea un adaptador para datos que provienen de Google Sheets/Google Finance.
 * Puede recibir históricos ya cargados por ticker o consultar directamente
 * una hoja pública mediante Google Visualization (gviz).
 *
 * @param {Object} config
 * @param {string} config.spreadsheetId ID del Google Sheet
 * @param {Object<string,string>} [config.sheetByTicker] Mapa ticker -> nombre de pestaña
 * @param {Object<string,string>} [config.historicosPorTicker] Datos precargados para tests/offline
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
    const sheet = encodeURIComponent(nombrePestana(ticker).replace(/'/g, "''"));
    const query = encodeURIComponent('select A, B where A is not null order by A');
    return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/gviz/tq?sheet=${sheet}&tqx=out:csv&tq=${query}`;
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
    const historico = parsearHistoricoGoogleSheets(texto);
    if (!historico.length) {
      throw new Error(`No se encontraron cierres para ${ticker} en la pestaña ${nombrePestana(ticker)}.`);
    }
    return historico;
  };

  return crearProveedorMercado({
    name: 'Google Sheets / Google Finance',

    async getHistory(ticker) {
      const historico = await cargarHistorico(ticker);
      return {
        ticker,
        data: historico,
        source: 'Google Sheets / Google Finance'
      };
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
  parsearHistoricoGoogleSheets,
  calcularRSI,
  crearProveedorMercado,
  crearProveedorGoogleSheets
};
