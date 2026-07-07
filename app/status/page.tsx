'use client';

import React, { useState, useEffect, useCallback } from 'react';
import styles from './status.module.css';

interface FailedTask {
  id: string;
  payload: {
    feed_url: string;
    keywords?: string[];
  };
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  updated_at: string;
}

interface Metrics {
  counts: {
    queued: number;
    processing: number;
    done: number;
    failed: number;
  };
  average_processing_time_seconds: number;
  recent_done_count_last_hour: number;
}

export default function StatusPage() {
  const [metrics, setMetrics] = useState<Metrics>({
    counts: { queued: 0, processing: 0, done: 0, failed: 0 },
    average_processing_time_seconds: 0,
    recent_done_count_last_hour: 0,
  });
  const [failedTasks, setFailedTasks] = useState<FailedTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const [isAddingTasks, setIsAddingTasks] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [retryingTasks, setRetryingTasks] = useState<Record<string, boolean>>({});

  // Секретный токен для локального тестирования
  const localSecret = 'local-dev-secret';

  // Функция для запроса метрик
  const fetchMetrics = useCallback(async (showLoader = false) => {
    if (showLoader) setIsLoading(true);
    try {
      const response = await fetch('/api/metrics');
      if (!response.ok) {
        throw new Error(`Ошибка HTTP: ${response.status}`);
      }
      const data = await response.json();
      if (data.success) {
        setMetrics(data.metrics);
        setFailedTasks(data.failed_tasks || []);
      } else {
        throw new Error(data.error || 'Не удалось загрузить метрики');
      }
    } catch (err: any) {
      console.error(err);
      setBanner({
        type: 'error',
        message: `Не удалось обновить метрики: ${err.message}`,
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Первичный запрос и автообновление
  useEffect(() => {
    fetchMetrics(true);
  }, [fetchMetrics]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchMetrics(false);
    }, 10000); // каждые 10 секунд
    return () => clearInterval(interval);
  }, [autoRefresh, fetchMetrics]);

  // Запуск воркера (process-queue)
  const handleProcessQueue = async () => {
    setIsProcessingQueue(true);
    setBanner(null);
    try {
      const response = await fetch(`/api/process-queue?secret=${localSecret}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Ошибка HTTP: ${response.status}`);
      }

      if (data.success) {
        const details = data.processed_count > 0 
          ? ` Обработано задач: ${data.processed_count}.` 
          : ' Задач в очереди не обнаружено.';
        setBanner({
          type: 'success',
          message: `Воркер успешно отработал!${details}`,
        });
        fetchMetrics(false);
      } else {
        throw new Error(data.error || 'Ошибка при обработке очереди');
      }
    } catch (err: any) {
      setBanner({
        type: 'error',
        message: `Ошибка выполнения воркера: ${err.message}`,
      });
    } finally {
      setIsProcessingQueue(false);
    }
  };

  // Добавление тестового набора задач в очередь
  const handleAddMockTasks = async () => {
    setIsAddingTasks(true);
    setBanner(null);
    try {
      const mockPayload = {
        tasks: [
          {
            feed_url: 'https://news.ycombinator.com/rss',
            keywords: ['python', 'ai', 'rust', 'startup'],
          },
          {
            feed_url: 'https://techcrunch.com/feed/',
            keywords: ['funding', 'apple', 'startup', 'nvidia'],
          },
          {
            feed_url: 'http://feeds.bbci.co.uk/news/rss.xml',
            keywords: ['science', 'world', 'climate'],
          },
          {
            feed_url: 'https://this-feed-does-not-exist.com/rss-error-test',
            keywords: ['error'],
          },
        ],
        max_attempts: 3,
      };

      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(mockPayload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Ошибка HTTP: ${response.status}`);
      }

      if (data.success) {
        setBanner({
          type: 'success',
          message: `Тестовые задачи добавлены: 3 корректные RSS-ленты и 1 с ошибкой для демонстрации ретраев. Всего: ${data.tasks?.length}`,
        });
        fetchMetrics(false);
      } else {
        throw new Error(data.error || 'Ошибка добавления задач');
      }
    } catch (err: any) {
      setBanner({
        type: 'error',
        message: `Ошибка добавления задач: ${err.message}`,
      });
    } finally {
      setIsAddingTasks(false);
    }
  };

  // Перезапуск упавшей задачи
  const handleRetryTask = async (taskId: string) => {
    setRetryingTasks((prev) => ({ ...prev, [taskId]: true }));
    try {
      const response = await fetch('/api/tasks/retry', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ taskId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Ошибка HTTP: ${response.status}`);
      }

      if (data.success) {
        setBanner({
          type: 'success',
          message: `Задача ${taskId.substring(0, 8)}... успешно отправлена на повторную обработку.`,
        });
        fetchMetrics(false);
      } else {
        throw new Error(data.error || 'Не удалось перезапустить задачу');
      }
    } catch (err: any) {
      setBanner({
        type: 'error',
        message: `Ошибка перезапуска задачи: ${err.message}`,
      });
    } finally {
      setRetryingTasks((prev) => ({ ...prev, [taskId]: false }));
    }
  };

  return (
    <main className={styles.container}>
      <div className={styles.wrapper}>
        
        {/* Шапка */}
        <header className={styles.header}>
          <div className={styles.titleArea}>
            <h1>Конвейер Обработки RSS</h1>
            <p className={styles.subtitle}>Панель мониторинга очереди задач и асинхронного парсера новостей</p>
          </div>
          <div className={styles.statusIndicator}>
            <span className={`${styles.statusDot} ${styles.statusDotPulse}`} />
            Соединение с Supabase активно
          </div>
        </header>

        {/* Уведомление */}
        {banner && (
          <div className={`${styles.banner} ${banner.type === 'success' ? styles.bannerSuccess : styles.bannerError}`}>
            <span>{banner.message}</span>
            <button className={styles.bannerClose} onClick={() => setBanner(null)}>×</button>
          </div>
        )}

        {/* Автообновление */}
        <div className={styles.refreshRow}>
          <input
            id="autoRefresh"
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className={styles.checkbox}
          />
          <label htmlFor="autoRefresh" style={{ cursor: 'pointer' }}>Автообновление (10с)</label>
        </div>

        {/* Панель Управления */}
        <div className={styles.actionsRow}>
          <button
            onClick={handleProcessQueue}
            disabled={isProcessingQueue || isLoading}
            className={`${styles.btn} ${styles.btnPrimary}`}
          >
            {isProcessingQueue ? 'Выполнение воркера...' : 'Запустить обработку очереди (Worker)'}
          </button>
          <button
            onClick={handleAddMockTasks}
            disabled={isAddingTasks || isLoading}
            className={`${styles.btn} ${styles.btnSecondary}`}
          >
            {isAddingTasks ? 'Добавление задач...' : 'Добавить тестовые RSS-ленты в очередь'}
          </button>
          <button
            onClick={() => fetchMetrics(true)}
            disabled={isLoading}
            className={`${styles.btn} ${styles.btnSecondary}`}
          >
            Обновить данные
          </button>
        </div>

        {/* Метрики */}
        <section className={styles.statsGrid}>
          <div className={styles.card}>
            <div className={`${styles.cardGlow} ${styles.glowQueued}`} />
            <span className={styles.cardHeader}>В Очереди (Queued)</span>
            <span className={styles.cardValue}>{metrics.counts.queued}</span>
            <span className={styles.cardSubtext}>Ожидают запуска воркером</span>
          </div>
          <div className={styles.card}>
            <div className={`${styles.cardGlow} ${styles.glowProcessing}`} />
            <span className={styles.cardHeader}>Обрабатываются (Processing)</span>
            <span className={styles.cardValue}>{metrics.counts.processing}</span>
            <span className={styles.cardSubtext}>Активно выполняются</span>
          </div>
          <div className={styles.card}>
            <div className={`${styles.cardGlow} ${styles.glowDone}`} />
            <span className={styles.cardHeader}>Выполнено (Done)</span>
            <span className={styles.cardValue}>{metrics.counts.done}</span>
            <span className={styles.cardSubtext}>Успешно спарсено фидов</span>
          </div>
          <div className={styles.card}>
            <div className={`${styles.cardGlow} ${styles.glowFailed}`} />
            <span className={styles.cardHeader}>Ошибка (Failed)</span>
            <span className={styles.cardValue}>{metrics.counts.failed}</span>
            <span className={styles.cardSubtext}>Попытки полностью исчерпаны</span>
          </div>
          <div className={styles.card}>
            <div className={`${styles.cardGlow} ${styles.glowSpeed}`} />
            <span className={styles.cardHeader}>Ср. Время Выполнения</span>
            <span className={styles.cardValue}>
              {metrics.average_processing_time_seconds > 0 
                ? `${metrics.average_processing_time_seconds}с` 
                : '—'}
            </span>
            <span className={styles.cardSubtext}>За последний час</span>
          </div>
        </section>

        {/* Раздел Ошибок */}
        <section className={styles.sectionsLayout}>
          <div className={styles.sectionBox}>
            <h2 className={styles.sectionTitle}>
              <span className={styles.sectionTitleIcon}>⚠</span> Лог сбоев (Последние 10 ошибок)
            </h2>
            
            {isLoading && failedTasks.length === 0 ? (
              <p style={{ color: '#9ca3af' }}>Загрузка сведений о сбоях...</p>
            ) : failedTasks.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyStateIcon}>🎉</div>
                <p>Все задачи выполнены без ошибок или очередь пуста.</p>
              </div>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>RSS-Лента / URL</th>
                      <th>Попыток</th>
                      <th>Описание ошибки</th>
                      <th>Дата ошибки</th>
                      <th>Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failedTasks.map((task) => (
                      <tr key={task.id}>
                        <td>
                          <div className={styles.taskUrl}>{task.payload.feed_url}</div>
                          {task.payload.keywords && task.payload.keywords.length > 0 && (
                            <div className={styles.taskKeywords}>
                              {task.payload.keywords.map((kw, i) => (
                                <span key={i} className={styles.keywordBadge}>{kw}</span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={styles.attemptsBadge}>
                            {task.attempts}/{task.max_attempts}
                          </span>
                        </td>
                        <td>
                          <div className={styles.errorText} title={task.last_error || ''}>
                            {task.last_error || 'Не указана'}
                          </div>
                        </td>
                        <td>
                          <span className={styles.timeText}>
                            {new Date(task.updated_at).toLocaleString('ru-RU')}
                          </span>
                        </td>
                        <td>
                          <button
                            onClick={() => handleRetryTask(task.id)}
                            disabled={retryingTasks[task.id]}
                            className={`${styles.btn} ${styles.btnSecondary}`}
                            style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem' }}
                          >
                            {retryingTasks[task.id] ? 'Запуск...' : 'Перезапустить'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
        
      </div>
    </main>
  );
}
