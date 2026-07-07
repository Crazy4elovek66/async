import { supabase } from './supabase';

export type TaskStatus = 'queued' | 'processing' | 'done' | 'failed';

export interface Task {
  id: string;
  payload: any;
  status: TaskStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  result: any | null;
  created_at: string;
  updated_at: string;
}

/**
  * Добавление задач в очередь
  */
export async function enqueueTasks(payloads: any[], maxAttempts: number = 3): Promise<Task[]> {
  if (payloads.length === 0) return [];

  const rows = payloads.map((payload) => ({
    payload,
    status: 'queued' as TaskStatus,
    attempts: 0,
    max_attempts: maxAttempts,
  }));

  const { data, error } = await supabase
    .from('tasks')
    .insert(rows)
    .select();

  if (error) {
    throw new Error(`Ошибка постановки задач в очередь: ${error.message}`);
  }

  return data as Task[];
}

/**
  * Атомарный захват готовых к обработке задач с блокировкой
  */
export async function acquireTasks(limit: number): Promise<Task[]> {
  const { data, error } = await supabase.rpc('acquire_queued_tasks', {
    max_tasks: limit,
  });

  if (error) {
    throw new Error(`Ошибка захвата задач из очереди: ${error.message}`);
  }

  return data as Task[];
}

/**
  * Перевод задачи в статус Успешно Завершена
  */
export async function markTaskDone(taskId: string, result: any): Promise<void> {
  const { error } = await supabase
    .from('tasks')
    .update({
      status: 'done' as TaskStatus,
      result,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId);

  if (error) {
    throw new Error(`Ошибка обновления статуса задачи на DONE: ${error.message}`);
  }
}

/**
  * Перевод задачи в статус Ошибка/Ретрай
  */
export async function markTaskFailedOrRetry(
  task: Task,
  errorMsg: string
): Promise<void> {
  const nextAttempts = task.attempts + 1;
  const shouldRetry = nextAttempts < task.max_attempts;
  const newStatus: TaskStatus = shouldRetry ? 'queued' : 'failed';

  const { error } = await supabase
    .from('tasks')
    .update({
      status: newStatus,
      attempts: nextAttempts,
      last_error: errorMsg,
      updated_at: new Date().toISOString(),
    })
    .eq('id', task.id);

  if (error) {
    throw new Error(
      `Ошибка обновления статуса задачи на ${newStatus}: ${error.message}`
    );
  }
}

/**
  * Сброс задачи для повторного запуска (для админ-панели)
  */
export async function retryTask(taskId: string): Promise<void> {
  const { error } = await supabase
    .from('tasks')
    .update({
      status: 'queued' as TaskStatus,
      attempts: 0,
      last_error: null,
      result: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId);

  if (error) {
    throw new Error(`Ошибка перезапуска задачи: ${error.message}`);
  }
}
