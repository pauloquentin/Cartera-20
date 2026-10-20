// CARTERA 20 — Motor de datos de mercado
// Esta primera versión contiene únicamente el cálculo de RSI-14 con Wilder.
// La fuente de datos (Google Finance u otra) se conectará posteriormente.

/**
 * Calcula el RSI-14 mediante el suavizado de Wilder.
 *
 * @param {Array<{date:string, close:number}>} historicos
 * @returns {{value:number|null, date:string|null, periods:number, status:string}}
 */
function calcularRSI(historicos) {
  if (!Array.isArray(historicos) || historicos.length < 15) {
    return {
      value: null,
      date: null,
      periods: 0,
      status: 'insufficient-data'
    };
  }

  const datos = historicos
    .map(item => ({
      date: item.date,
      close: Number(item.close)
    }))
    .filter(item => Number.isFinite(item.close) && item.close > 0);

  if (datos.length < 15) {
    return {
      value: null,
      date: null,
      periods: datos.length,
      status: 'insufficient-data'
    };
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
  let rsi = averageLoss === 0
    ? 100
    : 100 - (100 / (1 + (averageGain / averageLoss)));

  for (let i = 15; i < datos.length; i += 1) {
    const change = datos[i].close - datos[i - 1].close;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    averageGain = ((averageGain * 13) + gain) / 14;
    averageLoss = ((averageLoss * 13) + loss) / 14;

    rsi = averageLoss === 0
      ? 100
      : 100 - (100 / (1 + (averageGain / averageLoss)));
  }

  return {
    value: rsi,
    date: datos[datos.length - 1].date,
    periods: datos.length - 1,
    status: 'ok'
  };
}

// Export compatible con navegador y fácil de probar desde consola.
window.Cartera20MarketData = {
  calcularRSI
};
