import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";
import { createChart, IChartApi, ISeriesApi, CandlestickData, BarData, UTCTimestamp, LineStyle } from 'lightweight-charts';

// Data structures
interface OHLCV {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface SentimentResult {
  sentiment: 'Positivo' | 'Neutro' | 'Negativo';
  summary: string;
  icon: string;
  coingeckoId: string;
}

// Renko Chart Component
const RenkoChart = ({ data, lastUpdated }: { data: OHLCV[], lastUpdated: Date | null }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current || data.length === 0) return;

    // --- Chart Initialization ---
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#1c2333' },
        textColor: '#e0e0e0',
      },
      grid: {
        vertLines: { color: '#2a3447' },
        horzLines: { color: '#2a3447' },
      },
      timeScale: {
        borderColor: '#4b5563',
        timeVisible: true,
      },
      crosshair: {
        mode: 1, // Magnet mode
        vertLine: {
          width: 4,
          color: '#C3BCDB44',
          style: LineStyle.Solid,
          labelBackgroundColor: '#9B7DFF',
        },
        horzLine: {
          color: '#9B7DFF',
          labelBackgroundColor: '#9B7DFF',
        },
      },
    });
    chartRef.current = chart;

    const renkoSeries = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });


    // --- Renko Calculation ---
    const calculateATR = (period: number): number => {
      let sum = 0;
      for (let i = 1; i < data.length; i++) {
        const high = data[i].high;
        const low = data[i].low;
        const prevClose = data[i-1].close;
        sum += Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      }
      return sum / (data.length -1);
    };

    const atr = calculateATR(14);
    const brickSize = Math.max(atr, data[data.length-1].close * 0.005); // Use ATR or 0.5% of last price
    
    const renkoData: (CandlestickData | BarData)[] = [];
    if(data.length > 0) {
        let lastBrickClose = data[0].open;
        
        data.forEach(d => {
            const price = d.close;
            const movement = price - lastBrickClose;

            if(Math.abs(movement) >= brickSize) {
                const direction = Math.sign(movement);
                const brickCount = Math.floor(Math.abs(movement) / brickSize);

                for(let i = 0; i < brickCount; i++) {
                    const open = lastBrickClose;
                    const close = open + (brickSize * direction);
                    renkoData.push({ time: d.time, open, high: Math.max(open,close), low: Math.min(open,close), close });
                    lastBrickClose = close;
                }
            }
        });
    }

    renkoSeries.setData(renkoData);

    // --- Markers for High/Low ---
    if(data.length > 0) {
      const [overallHigh, overallLow] = data.reduce(([h, l], d) => [
          d.high > h.price ? { price: d.high, time: d.time } : h,
          d.low < l.price ? { price: d.low, time: d.time } : l,
      ], [{ price: data[0].high, time: data[0].time }, { price: data[0].low, time: data[0].time }]);
      
      renkoSeries.setMarkers([
          { time: overallHigh.time, position: 'aboveBar', color: '#2563eb', shape: 'arrowDown', text: `Máxima: ${overallHigh.price.toFixed(2)}` },
          { time: overallLow.time, position: 'belowBar', color: '#ef4444', shape: 'arrowUp', text: `Mínima: ${overallLow.price.toFixed(2)}` }
      ]);
    }


    chart.timeScale().fitContent();

    // --- Cleanup ---
    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [data]);

  return (
    <div className="chart-container">
        <div className="chart-header">
            <h3 className="chart-title">Gráfico Renko (Últimos 7 Dias)</h3>
            {lastUpdated && <p className="last-updated">Última Atualização: {lastUpdated.toLocaleTimeString()}</p>}
        </div>
        <div ref={chartContainerRef} className="chart-wrapper" />
    </div>
  );
};


const App = () => {
  const [asset, setAsset] = useState<string>('');
  const [result, setResult] = useState<SentimentResult | null>(null);
  const [chartData, setChartData] = useState<OHLCV[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [searchedAsset, setSearchedAsset] = useState<string>('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchChartData = useCallback(async (coinId: string) => {
    if (!coinId) return;
    try {
        const response = await fetch(`https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=7`);
        if (!response.ok) {
            throw new Error(`Dados de mercado não encontrados para ${coinId}`);
        }
        const rawData: [number, number, number, number, number][] = await response.json();
        
        // CoinGecko API returns [time, open, high, low, close]
        const formattedData: OHLCV[] = rawData.map(d => ({
            time: (d[0] / 1000) as UTCTimestamp,
            open: d[1],
            high: d[2],
            low: d[3],
            close: d[4],
        }));

        setChartData(formattedData);
        setLastUpdated(new Date());

    } catch (e) {
        console.error("Erro ao buscar dados do gráfico:", e);
        setError(`Não foi possível carregar os dados do gráfico para "${searchedAsset}". Verifique o nome do ativo.`);
        setChartData([]); // Clear previous chart data on error
    }
  }, [searchedAsset]);


  useEffect(() => {
    if (!result?.coingeckoId || result.coingeckoId === 'id-nao-encontrado') {
        return;
    }

    fetchChartData(result.coingeckoId); // Fetch immediately

    const intervalId = setInterval(() => {
        fetchChartData(result.coingeckoId)
    }, 60000); // Refresh every 60 seconds

    return () => clearInterval(intervalId); // Cleanup on component unmount or when result changes
  }, [result, fetchChartData]);


  const handleAnalyze = async () => {
    if (!asset.trim()) {
      setError('Por favor, digite o nome de um ativo.');
      return;
    }
    setLoading(true);
    setResult(null);
    setChartData([]);
    setError('');
    setSearchedAsset(asset);

    try {
      setLoadingMessage('Analisando sentimento com IA...');
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Analise o sentimento do mercado para o ativo financeiro: "${asset}". Baseie-se em notícias recentes e discussões. Forneça também o ID da API CoinGecko para este ativo (em minúsculas, sem espaços, ex: 'bitcoin', 'ethereum'). Se não tiver certeza ou o ativo não for uma criptomoeda conhecida, retorne 'id-nao-encontrado'.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              sentiment: { type: Type.STRING, enum: ["Positivo", "Neutro", "Negativo"], description: "O sentimento geral do mercado (Positivo, Neutro ou Negativo)." },
              summary: { type: Type.STRING, description: "Um resumo conciso (2-3 frases) explicando as razões para o sentimento identificado." },
              icon: { type: Type.STRING, description: "Um único emoji que representa o sentimento (ex: 😊, 😐, 😠)." },
              coingeckoId: { type: Type.STRING, description: "O ID do ativo na API CoinGecko (ex: 'bitcoin', 'ethereum') ou 'id-nao-encontrado'." }
            },
            required: ["sentiment", "summary", "icon", "coingeckoId"]
          },
        },
      });

      const jsonText = response.text.trim();
      const parsedResult: SentimentResult = JSON.parse(jsonText);

      if (parsedResult.coingeckoId === 'id-nao-encontrado') {
        setError(`Não foi possível encontrar dados de mercado em tempo real para "${asset}". A análise de sentimento ainda está disponível.`);
        setResult(parsedResult);
        setLoading(false);
        return;
      }
      
      setResult(parsedResult);
      setLoadingMessage('Buscando dados de mercado em tempo real...');
      // The useEffect will trigger the chart data fetch

    } catch (e) {
      console.error(e);
      setError('Ocorreu um erro ao analisar os dados. A IA pode não ter encontrado o ativo. Tente novamente.');
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  };

  const getSentimentClass = (sentiment: string): string => {
    switch (sentiment) {
      case 'Positivo': return 'positive';
      case 'Negativo': return 'negative';
      case 'Neutro': return 'neutral';
      default: return '';
    }
  };

  return (
    <div className="container">
      <header>
        <h1>Monitor de Sentimento de Ativos</h1>
        <p>
          Digite o nome de uma ação, criptomoeda ou ativo para obter uma análise de sentimento e um gráfico de tendências com dados reais.
        </p>
      </header>

      <main>
        <div className="input-group">
          <input
            type="text"
            value={asset}
            onChange={(e) => setAsset(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && !loading && handleAnalyze()}
            placeholder="Ex: Bitcoin, Ethereum"
            aria-label="Nome do Ativo"
            disabled={loading}
          />
          <button onClick={handleAnalyze} disabled={loading}>
            {loading ? (loadingMessage || 'Analisando...') : 'Analisar'}
          </button>
        </div>

        {loading && <div className="loader" aria-label="Carregando"></div>}
        
        {error && <div className="error-message">{error}</div>}

        {result && (
          <>
            <div className="result-card" role="region" aria-live="polite">
              <h2>Resultado para: <span>{searchedAsset}</span></h2>
              <div className="sentiment-display">
                <span className="icon" aria-hidden="true">{result.icon}</span>
                <span className={`text ${getSentimentClass(result.sentiment)}`}>
                  {result.sentiment}
                </span>
              </div>
              <p className="summary">{result.summary}</p>
            </div>
            {chartData && chartData.length > 0 && (
                <RenkoChart data={chartData} lastUpdated={lastUpdated}/>
            )}
          </>
        )}
      </main>
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);