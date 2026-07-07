import { NextResponse } from 'next/server';
import { enqueueTasks } from '@/lib/queue';

export async function POST(request: Request) {
  try {
    const body = await request.json();

    let tasksToEnqueue: any[] = [];
    let maxAttempts = 3;

    if (body.max_attempts && typeof body.max_attempts === 'number') {
      maxAttempts = body.max_attempts;
    }

    if (Array.isArray(body.tasks)) {
      tasksToEnqueue = body.tasks;
    } else if (body.feed_url) {
      tasksToEnqueue = [
        {
          feed_url: body.feed_url,
          keywords: Array.isArray(body.keywords) ? body.keywords : [],
        },
      ];
    } else {
      return NextResponse.json(
        { error: 'Неверный формат запроса. Передайте "feed_url" или массив "tasks".' },
        { status: 400 }
      );
    }

    // Проверка корректности параметров
    for (const t of tasksToEnqueue) {
      if (!t.feed_url) {
        return NextResponse.json(
          { error: 'Поле "feed_url" обязательно для всех задач.' },
          { status: 400 }
        );
      }
      try {
        new URL(t.feed_url);
      } catch (_) {
        return NextResponse.json(
          { error: `Некорректный URL: "${t.feed_url}"` },
          { status: 400 }
        );
      }
      if (!Array.isArray(t.keywords)) {
        return NextResponse.json(
          { error: 'Поле "keywords" должно быть массивом строк.' },
          { status: 400 }
        );
      }
    }

    const createdTasks = await enqueueTasks(tasksToEnqueue, maxAttempts);

    return NextResponse.json({
      success: true,
      message: `Успешно добавлено задач в очередь: ${createdTasks.length}`,
      tasks: createdTasks.map((t) => ({
        id: t.id,
        status: t.status,
        feed_url: t.payload.feed_url,
        keywords: t.payload.keywords,
      })),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: `Внутренняя ошибка сервера: ${error.message}` },
      { status: 500 }
    );
  }
}
