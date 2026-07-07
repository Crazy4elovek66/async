import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // 1. Сбор общего количества задач по статусам
    const statuses = ['queued', 'processing', 'done', 'failed'];
    const countPromises = statuses.map(async (status) => {
      const { count, error } = await supabase
        .from('tasks')
        .select('*', { count: 'exact', head: true })
        .eq('status', status);
      if (error) throw error;
      return { status, count: count || 0 };
    });

    // 2. Сбор последних 10 упавших задач
    const failedTasksPromise = supabase
      .from('tasks')
      .select('id, payload, attempts, max_attempts, last_error, updated_at')
      .eq('status', 'failed')
      .order('updated_at', { ascending: false })
      .limit(10);

    // 3. Выборка успешных задач за последний час для подсчета средней скорости обработки
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recentDonePromise = supabase
      .from('tasks')
      .select('created_at, updated_at')
      .eq('status', 'done')
      .gte('updated_at', oneHourAgo);

    // Выполняем запросы параллельно
    const [countsResult, failedResult, recentDoneResult] = await Promise.all([
      Promise.all(countPromises),
      failedTasksPromise,
      recentDonePromise,
    ]);

    if (failedResult.error) throw failedResult.error;
    if (recentDoneResult.error) throw recentDoneResult.error;

    // Преобразуем массив счетчиков в удобный объект
    const counts = countsResult.reduce((acc, curr) => {
      acc[curr.status] = curr.count;
      return acc;
    }, {} as Record<string, number>);

    // Вычисляем среднюю скорость обработки (в секундах) за последний час
    let averageProcessingTimeSec = 0;
    const recentTasks = recentDoneResult.data || [];
    if (recentTasks.length > 0) {
      const totalDurationMs = recentTasks.reduce((sum, task) => {
        const start = new Date(task.created_at).getTime();
        const end = new Date(task.updated_at).getTime();
        return sum + (end - start);
      }, 0);
      averageProcessingTimeSec = parseFloat(((totalDurationMs / recentTasks.length) / 1000).toFixed(2));
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      metrics: {
        counts,
        average_processing_time_seconds: averageProcessingTimeSec,
        recent_done_count_last_hour: recentTasks.length,
      },
      failed_tasks: failedResult.data || [],
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: `Ошибка сбора метрик: ${error.message}` },
      { status: 500 }
    );
  }
}
