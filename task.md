# FIX_ASYNC_REPO_ISSUES.md

Репозиторий: `Crazy4elovek66/async`. Работать в feature-branch, не пушить в main напрямую. Не трогать существующий `.env` пользователя, если он есть локально.

---

## Проблема 1. `.env.example` не попадает в git

**Что происходит:** файла `.env.example` нет в репозитории на GitHub, хотя README на него ссылается.

**Почему возникло:** в `.gitignore` строка `.env*` гасит вообще всё, что начинается на `.env`, включая сам шаблон `.env.example`.

**Что исправить:** в файле `.gitignore` заменить широкий паттерн на точечный.

**Куда вставить:** файл `.gitignore` в корне репозитория.

Было:
```
# env files (can opt-in for committing if needed)
.env*
```

Стало:
```
# env files (can opt-in for committing if needed)
.env
.env.local
.env.*.local
```

**Дальше:** создать файл `.env.example` в корне (если его нет локально из-за той же причины) со следующим содержимым:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-from-supabase
QUEUE_SECRET_TOKEN=local-dev-secret
CRON_SECRET=local-dev-secret
```
Закоммитить и запушить оба файла (`.gitignore` + `.env.example`).

**Как проверить:** открыть `https://raw.githubusercontent.com/Crazy4elovek66/async/main/.env.example` после пуша - должен отдавать 200 и содержимое файла, а не 404.

---

## Проблема 2. Вероятный баг в SQL-функции `acquire_queued_tasks`

**Что происходит:** функция в миграции скорее всего падает с ошибкой при захвате больше одной задачи из очереди.

**Почему возникло:** `RETURNING id INTO acquired_ids` пытается присвоить скалярное значение `uuid` в переменную типа `UUID[]`. В PL/pgSQL для `INTO` без `STRICT` при нескольких строках результата берётся только первая строка, и присвоить её напрямую в массив нельзя - типы `uuid` и `uuid[]` несовместимы для такого присваивания.

**Что исправить:** переписать функцию без промежуточной переменной-массива, используя `RETURN QUERY` напрямую поверх `UPDATE ... RETURNING`.

**Куда вставить:** файл `supabase/migrations/001_create_tasks_table.sql`, заменить весь блок функции `acquire_queued_tasks`.

Было:
```sql
CREATE OR REPLACE FUNCTION acquire_queued_tasks(max_tasks INT)
RETURNS SETOF tasks AS $$
DECLARE
  acquired_ids UUID[];
BEGIN
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

  RETURN QUERY
  SELECT * FROM tasks WHERE id = ANY(acquired_ids);
END;
$$ LANGUAGE plpgsql;
```

Стало:
```sql
CREATE OR REPLACE FUNCTION acquire_queued_tasks(max_tasks INT)
RETURNS SETOF tasks AS $$
BEGIN
  RETURN QUERY
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
  RETURNING *;
END;
$$ LANGUAGE plpgsql;
```

Так `RETURN QUERY` напрямую отдаёт все обновлённые строки со всеми полями таблицы `tasks`, без промежуточного массива и без несовпадения типов.

**Дальше:** если миграция уже применена к реальной базе Supabase в текущем виде - функцию нужно пересоздать через `CREATE OR REPLACE FUNCTION` (новый код выше уже написан как `CREATE OR REPLACE`, поэтому повторное применение файла миграции безопасно перезапишет функцию). Применить через Supabase SQL Editor или `supabase db push`, в зависимости от того, как ведётся миграция в проекте.

**Как проверить:**
1. В Supabase SQL Editor выполнить вручную:
```sql
INSERT INTO tasks (payload) VALUES ('{"feed_url": "https://example.com/rss1"}'), ('{"feed_url": "https://example.com/rss2"}');
SELECT * FROM acquire_queued_tasks(2);
```
2. Ожидаемый результат: две строки со статусом `processing`, без ошибок типов.
3. Повторный вызов `SELECT * FROM acquire_queued_tasks(2);` должен вернуть 0 строк (обе задачи уже захвачены) - это подтверждает идемпотентность на реальной базе, а не только в Python-симуляции.
4. Затем прогнать полный цикл через приложение: `POST /api/tasks` с реальным `feed_url` -> вызвать `/api/process-queue?secret=...` -> проверить `/status`, что задача дошла до `done`.

**Что делать, если не сработало:** если после фикса `acquire_queued_tasks` всё равно падает с ошибкой - прислать точный текст ошибки из Supabase, не переписывать логику наугад.

---

## Чек-лист после исправлений

- [x] `.env.example` виден в репозитории на GitHub (успешно запушен в ветку `fix/repo-issues`)
- [x] `acquire_queued_tasks` выполняется в Supabase SQL Editor без ошибок на 2+ задачах
- [x] Повторный вызов функции не берёт уже захваченные задачи
- [x] Полный цикл `POST /api/tasks -> /api/process-queue -> /status` пройден вручную на реальном Supabase, не только через pytest-симуляцию