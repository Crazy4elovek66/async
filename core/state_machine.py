import enum
from typing import Any, Dict, Optional, Callable, Awaitable
import datetime

class TaskStatus(str, enum.Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    DONE = "done"
    FAILED = "failed"

class Task:
    def __init__(
        self,
        task_id: str,
        payload: Dict[str, Any],
        status: TaskStatus = TaskStatus.QUEUED,
        attempts: int = 0,
        max_attempts: int = 3,
        last_error: Optional[str] = None,
        result: Optional[Dict[str, Any]] = None,
        created_at: Optional[datetime.datetime] = None,
        updated_at: Optional[datetime.datetime] = None
    ):
        self.id = task_id
        self.payload = payload
        self.status = status
        self.attempts = attempts
        self.max_attempts = max_attempts
        self.last_error = last_error
        self.result = result
        self.created_at = created_at or datetime.datetime.now(datetime.timezone.utc)
        self.updated_at = updated_at or datetime.datetime.now(datetime.timezone.utc)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "payload": self.payload,
            "status": self.status.value,
            "attempts": self.attempts,
            "max_attempts": self.max_attempts,
            "last_error": self.last_error,
            "result": self.result,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class TaskStateMachine:
    """
    Класс управления жизненным циклом и переходами состояний задачи (State Machine).
    Содержит чистую бизнес-логику без привязки к конкретной СУБД.
    """

    @staticmethod
    def transition_to_processing(task: Task) -> None:
        """
        Перевод задачи в статус обработки.
        Используется для фиксации захвата задачи воркером.
        """
        if task.status != TaskStatus.QUEUED:
            raise ValueError(f"Невозможно запустить задачу {task.id}: текущий статус {task.status.value}, а должен быть {TaskStatus.QUEUED.value}")
        
        task.status = TaskStatus.PROCESSING
        task.updated_at = datetime.datetime.now(datetime.timezone.utc)

    @staticmethod
    def transition_to_done(task: Task, result: Dict[str, Any]) -> None:
        """
        Перевод задачи в статус успешно завершенной с сохранением результата.
        """
        if task.status != TaskStatus.PROCESSING:
            raise ValueError(f"Невозможно завершить задачу {task.id}: текущий статус {task.status.value}, а должен быть {TaskStatus.PROCESSING.value}")
        
        task.status = TaskStatus.DONE
        task.result = result
        task.updated_at = datetime.datetime.now(datetime.timezone.utc)

    @staticmethod
    def transition_to_failed_or_retry(task: Task, error_message: str) -> None:
        """
        Обработка ошибки выполнения задачи.
        Увеличивает счетчик попыток. Если лимит попыток не исчерпан - возвращает в очередь.
        Если попытки исчерпаны - переводит в статус failed.
        """
        if task.status != TaskStatus.PROCESSING:
            raise ValueError(f"Невозможно обработать ошибку для задачи {task.id}: текущий статус {task.status.value}, а должен быть {TaskStatus.PROCESSING.value}")
        
        task.attempts += 1
        task.last_error = error_message
        task.updated_at = datetime.datetime.now(datetime.timezone.utc)

        if task.attempts < task.max_attempts:
            # Возвращаем в очередь (ретрай произойдет при следующем тике крона)
            task.status = TaskStatus.QUEUED
        else:
            # Превышен лимит попыток
            task.status = TaskStatus.FAILED


class TaskProcessor:
    """
    Оркестратор выполнения логики задачи с использованием TaskStateMachine.
    """
    def __init__(self, state_machine: TaskStateMachine = TaskStateMachine()):
        self.sm = state_machine

    async def process(self, task: Task, handler_fn: Callable[[Dict[str, Any]], Awaitable[Dict[str, Any]]]) -> Task:
        """
        Асинхронный запуск обработчика задачи с обработкой исключений и сменой состояний.
        """
        try:
            self.sm.transition_to_processing(task)
        except ValueError as e:
            # Если задача не в том статусе, прерываем
            task.last_error = str(e)
            return task

        try:
            # Вызов пользовательского асинхронного обработчика
            result = await handler_fn(task.payload)
            self.sm.transition_to_done(task, result)
        except Exception as e:
            error_msg = f"{type(e).__name__}: {str(e)}"
            self.sm.transition_to_failed_or_retry(task, error_msg)

        return task
