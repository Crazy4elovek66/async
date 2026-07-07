-- 001_create_tasks_table.sql
-- Создание таблицы задач для асинхронного конвейера данных

-- Создаем тип перечисления для статусов (или используем check constraint)
-- Использование CHECK-ограничения гибче при миграциях на serverless Postgres
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'queued' 
        CONSTRAINT check_task_status CHECK (status IN ('queued', 'processing', 'done', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    last_error TEXT,
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Индекс по статусу и дате создания для быстрой выборки задач из очереди воркером
CREATE INDEX IF NOT EXISTS idx_tasks_status_created_at ON tasks (status, created_at) 
WHERE status = 'queued';

-- Индекс по дате обновления (полезно для аналитики и метрик последних задач)
CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks (updated_at);

-- Функция для обновления поля updated_at перед записью строки
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Триггер для автоматического обновления updated_at
CREATE OR REPLACE TRIGGER trigger_update_tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Настройка RLS (Row Level Security)
-- По умолчанию закрываем все публичные доступы
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Создаем политику, разрешающую полный доступ только для service_role
CREATE POLICY service_role_access ON tasks
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Функция для атомарного идемпотентного захвата задач из очереди воркером
CREATE OR REPLACE FUNCTION acquire_queued_tasks(max_tasks INT)
RETURNS SETOF tasks AS $$
DECLARE
  acquired_ids UUID[];
BEGIN
  -- Атомарное обновление статуса выбранных задач с блокировкой строк
  WITH selected_tasks AS (
    SELECT id FROM tasks
    WHERE status = 'queued'
    ORDER BY created_at ASC
    LIMIT max_tasks
    FOR UPDATE SKIP LOCKED
  )
  UPDATE tasks
  SET status = 'processing', updated_at = NOW()
  WHERE id IN (SELECT id FROM selected_tasks)
  RETURNING id INTO acquired_ids;

  -- Возвращаем все поля для обновленных задач
  RETURN QUERY
  SELECT * FROM tasks WHERE id = ANY(acquired_ids);
END;
$$ LANGUAGE plpgsql;

