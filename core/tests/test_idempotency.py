import pytest
import asyncio
from typing import List
from core.state_machine import Task, TaskStatus, TaskStateMachine

class SafeTaskRepository:
    """
    Потокобезопасный/асинхронный репозиторий задач.
    Имитирует поведение базы данных с блокировкой строк (SELECT ... FOR UPDATE SKIP LOCKED).
    """
    def __init__(self, tasks: List[Task]):
        self.tasks = tasks
        self._lock = asyncio.Lock()

    async def acquire_tasks(self, limit: int) -> List[Task]:
        async with self._lock:
            acquired = []
            for task in self.tasks:
                if len(acquired) >= limit:
                    break
                if task.status == TaskStatus.QUEUED:
                    # Атомарно переводим в processing при захвате
                    TaskStateMachine.transition_to_processing(task)
                    acquired.append(task)
            return acquired


class UnsafeTaskRepository:
    """
    Небезопасный репозиторий без блокировок.
    Имитирует race condition, когда два воркера проверяют статус до его обновления.
    """
    def __init__(self, tasks: List[Task]):
        self.tasks = tasks

    async def acquire_tasks(self, limit: int) -> List[Task]:
        acquired = []
        for task in self.tasks:
            if len(acquired) >= limit:
                break
            if task.status == TaskStatus.QUEUED:
                # Пауза, чтобы спровоцировать переключение контекста
                # и дать другому воркеру зайти в это же условие
                await asyncio.sleep(0.01)
                TaskStateMachine.transition_to_processing(task)
                acquired.append(task)
        return acquired


@pytest.mark.asyncio
async def test_safe_concurrent_acquisition():
    """
    Проверяет, что при безопасном (атомарном) захвате
    несколько параллельных воркеров не схватят одну и ту же задачу.
    """
    shared_tasks = [
        Task(task_id="t-1", payload={}),
        Task(task_id="t-2", payload={}),
        Task(task_id="t-3", payload={}),
    ]
    repo = SafeTaskRepository(shared_tasks)

    # Запускаем 3 воркера параллельно
    async def worker(worker_id: int):
        return await repo.acquire_tasks(limit=2)

    results = await asyncio.gather(
        worker(1),
        worker(2),
        worker(3)
    )

    # Собираем все захваченные задачи
    all_acquired_ids = []
    for worker_result in results:
        for t in worker_result:
            all_acquired_ids.append(t.id)

    # Проверяем, что каждая задача была захвачена ровно один раз
    assert len(all_acquired_ids) == 3
    assert len(set(all_acquired_ids)) == 3
    # Все задачи должны быть в статусе PROCESSING
    assert all(t.status == TaskStatus.PROCESSING for t in shared_tasks)


@pytest.mark.asyncio
async def test_unsafe_concurrent_acquisition_failure():
    """
    Проверяет, что без блокировок возникает race condition,
    и задачи захватываются дважды (ValueError от автомата состояний).
    """
    shared_tasks = [
        Task(task_id="t-1", payload={}),
    ]
    repo = UnsafeTaskRepository(shared_tasks)

    async def worker(worker_id: int):
        return await repo.acquire_tasks(limit=1)

    # Ожидаем, что возникнет ValueError, так как один из воркеров
    # попытается перевести задачу из PROCESSING в PROCESSING.
    with pytest.raises(ValueError) as exc_info:
        await asyncio.gather(
            worker(1),
            worker(2)
        )
    
    assert "Невозможно запустить задачу" in str(exc_info.value)
