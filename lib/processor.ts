import Parser from 'rss-parser';

export interface RSSMatch {
  title: string;
  link: string;
  pubDate?: string;
  contentSnippet?: string;
}

export interface ProcessingResult {
  feed_title: string;
  checked_at: string;
  total_items: number;
  matched_count: number;
  matches: RSSMatch[];
}

/**
 * Логика обработки одной задачи по RSS-парсингу.
 * Скачивает RSS-ленту по указанному URL, парсит ее и ищет ключевые слова.
 */
export async function processRSSFeed(
  feedUrl: string,
  keywords: string[]
): Promise<ProcessingResult> {
  if (!feedUrl) {
    throw new Error('Пустой URL фида');
  }

  // Настройка таймаута скачивания (8 секунд) для предотвращения зависания serverless
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  let xmlText = '';
  try {
    const response = await fetch(feedUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AntigravityFeedAggregator/1.0',
      },
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP статус ${response.status}: ${response.statusText}`);
    }
    xmlText = await response.text();
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Превышен таймаут запроса RSS-ленты (8 секунд) для URL: ${feedUrl}`);
    }
    throw new Error(`Не удалось загрузить RSS-ленту: ${err.message}`);
  }

  const parser = new Parser();
  let feed;
  try {
    feed = await parser.parseString(xmlText);
  } catch (err: any) {
    throw new Error(`Не удалось распарсить RSS XML: ${err.message}`);
  }

  const matches: RSSMatch[] = [];
  const lowercaseKeywords = keywords.map((kw) => kw.toLowerCase());

  if (feed.items) {
    for (const item of feed.items) {
      const title = item.title || '';
      const content = item.content || item.contentSnippet || '';
      const textToSearch = `${title} ${content}`.toLowerCase();

      // Проверяем, есть ли совпадение по ключевым словам
      const isMatched = lowercaseKeywords.some((kw) => textToSearch.includes(kw));

      if (isMatched && item.title && item.link) {
        matches.push({
          title: item.title,
          link: item.link,
          pubDate: item.pubDate,
          contentSnippet: item.contentSnippet,
        });
      }
    }
  }

  return {
    feed_title: feed.title || 'Без названия',
    checked_at: new Date().toISOString(),
    total_items: feed.items ? feed.items.length : 0,
    matched_count: matches.length,
    matches,
  };
}
