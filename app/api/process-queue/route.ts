import { NextResponse } from 'next/server';
import { acquireTasks, markTaskDone, markTaskFailedOrRetry, Task } from '@/lib/queue';
import { processRSSFeed } from '@/lib/processor';

// Отключаем кэширование для этого эндпоинта
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const secretParam = searchParams.get('secret');

    // Проверка авторизации: Vercel Cron заголовок или секретный токен из env
    const cronSecret = process.env.CRON_SECRET;
    const customSecret = process.env.QUEUE_SECRET_TOKEN || 'local-dev-secret';

    const authHeader = request.headers.get('Authorization');
    const isCronAuthorized = authHeader === `Bearer ${cronSecret}` && cronSecret !== undefined;
    const isTokenAuthorized = secretParam === customSecret || (cronSecret && secretParam === cronSecret);

    // В целях упрощения локальной разработки, если секреты не заданы, разрешаем доступ
    const isLocalDev = !process.env.SUPABASE_SERVICE_ROLE_KEY; // или другая эвристика

    if (!isCronAuthorized && !isTokenAuthorized && process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'Доступ заблокирован: неверный токен авторизации.' },
        { status: 401 }
      );
    }

    // Захватываем пачку задач (до 10 штук за раз)
    const limit = 10;
    const tasks = await acquireTasks(limit);

    if (tasks.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Очередь пуста, задач для обработки нет.',
        processed_count: 0,
        results: [],
      });
    }

    const concurrencyLimit = 5;
    const results: { id: string; feed_url: string; status: 'done' | 'failed'; error?: string }[] = [];
    const executing = new Set<Promise<void>>();

    // Обертка для обработки одной задачи
    const executeTask = async (task: Task) => {
      const feedUrl = task.payload.feed_url;
      const keywords = task.payload.keywords || [];
      try {
        const processResult = await processRSSFeed(feedUrl, keywords);
        await markTaskDone(task.id, processResult);
        results.push({
          id: task.id,
          feed_url: feedUrl,
          status: 'done',
        });
      } catch (err: any) {
        const errorMsg = err.message || 'Неизвестная ошибка';
        await markTaskFailedOrRetry(task, errorMsg);
        results.push({
          id: task.id,
          feed_url: feedUrl,
          status: 'failed',
          error: errorMsg,
        });
      }
    };

    // Запускаем задачи с ограничением параллельности
    for (const task of tasks) {
      const taskPromise = executeTask(task).then(() => {
        executing.delete(taskPromise);
      });
      executing.add(taskPromise);

      if (executing.size >= concurrencyLimit) {
        await Promise.race(executing);
      }
    }

    // Ждем завершения оставшихся задач
    await Promise.all(executing);

    return NextResponse.json({
      success: true,
      message: `Обработка завершена. Задач в пачке: ${tasks.length}`,
      processed_count: tasks.length,
      results,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: `Ошибка обработчика очереди: ${error.message}` },
      { status: 500 }
    );
  }
}
