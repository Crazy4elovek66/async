import pytest
import asyncio
from core.state_machine import Task, TaskStatus, TaskStateMachine, TaskProcessor

def test_initial_task_state():
    task = Task(task_id="task-1", payload={"url": "http://example.com"})
    assert task.status == TaskStatus.QUEUED
    assert task.attempts == 0
    assert task.max_attempts == 3
    assert task.last_error is None
    assert task.result is None

def test_successful_transition_to_done():
    task = Task(task_id="task-1", payload={"url": "http://example.com"})
    sm = TaskStateMachine()

    sm.transition_to_processing(task)
    assert task.status == TaskStatus.PROCESSING

    result_data = {"articles_found": 5}
    sm.transition_to_done(task, result_data)
    assert task.status == TaskStatus.DONE
    assert task.result == result_data

def test_invalid_transitions():
    task = Task(task_id="task-1", payload={})
    sm = TaskStateMachine()

    # Нельзя завершить то, что еще не обрабатывается
    with pytest.raises(ValueError):
        sm.transition_to_done(task, {})

    # Нельзя выдать ошибку для того, что не обрабатывается
    with pytest.raises(ValueError):
        sm.transition_to_failed_or_retry(task, "error")

    sm.transition_to_processing(task)
    
    # Нельзя запустить то, что уже обрабатывается
    with pytest.raises(ValueError):
        sm.transition_to_processing(task)

def test_retry_logic_and_failure():
    task = Task(task_id="task-1", payload={}, max_attempts=2)
    sm = TaskStateMachine()

    # Попытка 1: ошибка
    sm.transition_to_processing(task)
    sm.transition_to_failed_or_retry(task, "Error 1")
    assert task.status == TaskStatus.QUEUED
    assert task.attempts == 1
    assert task.last_error == "Error 1"

    # Попытка 2: ошибка (достигнут лимит max_attempts = 2)
    sm.transition_to_processing(task)
    sm.transition_to_failed_or_retry(task, "Error 2")
    assert task.status == TaskStatus.FAILED
    assert task.attempts == 2
    assert task.last_error == "Error 2"

@pytest.mark.asyncio
async def test_async_task_processor_success():
    task = Task(task_id="task-1", payload={"value": 10})
    processor = TaskProcessor()

    async def mock_handler(payload):
        return {"doubled": payload["value"] * 2}

    processed_task = await processor.process(task, mock_handler)
    assert processed_task.status == TaskStatus.DONE
    assert processed_task.result == {"doubled": 20}
    assert processed_task.attempts == 0

@pytest.mark.asyncio
async def test_async_task_processor_failure_retry():
    task = Task(task_id="task-1", payload={"fail": True}, max_attempts=3)
    processor = TaskProcessor()

    async def mock_handler(payload):
        if payload.get("fail"):
            raise RuntimeError("Something went wrong")
        return {"ok": True}

    # Первая попытка упала
    processed_task = await processor.process(task, mock_handler)
    assert processed_task.status == TaskStatus.QUEUED
    assert processed_task.attempts == 1
    assert "RuntimeError: Something went wrong" in processed_task.last_error
