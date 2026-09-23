import { useEffect, useState } from 'react';
import { NewsHeadline, StockQuote } from '../data/models';
import { FeedStatus } from '../hooks/useWeather';

interface Props {
  news: NewsHeadline[];
  newsStatus: FeedStatus;
  stocks: StockQuote[];
  stocksStatus: FeedStatus;
  showNews: boolean;
}

/**
 * The full-width strip along the bottom: a rotating headline on the left,
 * every ticker on the right.
 *
 * This lives here rather than in the right rail because the rail simply
 * isn't tall enough for both — stacking them there is what pushed all but
 * the first ticker off the bottom of the screen. Across the full width,
 * all five quotes fit on one line with room to spare.
 */
export function TickerBar({ news, newsStatus, stocks, stocksStatus, showNews }: Props) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (news.length <= 1) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % news.length), 9000);
    return () => clearInterval(t);
  }, [news.length]);

  const current = news.length > 0 ? news[index % news.length] : null;

  return (
    <div className="ticker-bar">
      {showNews && (
        <div className="ticker-news">
          <span className="uppercase-label ticker-key">World</span>
          {current ? (
            <span className="ticker-headline" key={current.id}>
              <span className="ticker-source">{current.source}</span>
              {current.headline}
            </span>
          ) : (
            <span className="ticker-muted">
              {newsStatus === 'loading' ? 'Loading headlines…' : 'Headlines unavailable.'}
            </span>
          )}
        </div>
      )}

      <div className="ticker-stocks">
        <span className="uppercase-label ticker-key">Trending</span>
        {stocks.length > 0 ? (
          stocks.map((s) => (
            <span className="ticker-quote" key={s.symbol}>
              <span className="ticker-symbol">{s.symbol}</span>
              <span className="ticker-price tabular">{s.price.toFixed(2)}</span>
              <span className={`ticker-change ${s.changePct >= 0 ? 'up' : 'down'} tabular`}>
                {s.changePct >= 0 ? '+' : ''}
                {s.changePct.toFixed(2)}%
              </span>
            </span>
          ))
        ) : (
          <span className="ticker-muted">
            {stocksStatus === 'loading' ? 'Loading…' : 'Market data unavailable.'}
          </span>
        )}
      </div>
    </div>
  );
}
