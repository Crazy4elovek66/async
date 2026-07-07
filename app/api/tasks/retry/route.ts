import { NextResponse } from 'next/server';
import { retryTask } from '@/lib/queue';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { taskId } = body;

    if (!taskId) {
      return NextResponse.json(
        { error: 'Параметр "taskId" обязателен.' },
        { status: 400 }
      );
    }

    await retryTask(taskId);

    return NextResponse.json({
      success: true,
      message: `Задача ${taskId} успешно перезапущена (возвращена в статус queued).`,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: `Ошибка при перезапуске задачи: ${error.message}` },
      { status: 500 }
    );
  }
}
