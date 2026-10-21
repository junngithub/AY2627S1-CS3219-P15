from datetime import datetime, timedelta, timezone

from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config import settings

_jobstore_url = settings.database_url.replace("+asyncpg", "")

scheduler: AsyncIOScheduler | None = None


def start() -> None:
    global scheduler
    scheduler = AsyncIOScheduler(jobstores={"default": SQLAlchemyJobStore(url=_jobstore_url)})
    scheduler.start()


def schedule_ai_evaluation(case_id: str) -> None:
    """One-off durable job: run the AI right after creation (survives restarts)."""
    scheduler.add_job(
        "app.jobs.conflict_jobs:run_ai_evaluation",
        "date",
        run_date=datetime.now(timezone.utc),
        args=[case_id],
        id=f"ai-{case_id}",
        replace_existing=True,
        misfire_grace_time=3600,
    )


def schedule_conflict_timers(case_id: str, deadline: datetime) -> None:
    """
    Called once at case creation, using the case's stored deadline.
      - reminder at (deadline - reminder_before_deadline_hours)   [F3.7.1]
      - auto-resolution at the deadline                           [F3.3.1]
    Jobs re-check case state when they fire, so they're safe if the case
    was resolved/claimed meanwhile.
    """
    reminder_at = max(
        deadline - timedelta(hours=settings.reminder_before_deadline_hours),
        datetime.now(timezone.utc),
    )
    scheduler.add_job(
        "app.jobs.conflict_jobs:send_deadline_reminder",
        "date", run_date=reminder_at, args=[case_id],
        id=f"reminder-{case_id}", replace_existing=True, misfire_grace_time=3600,
    )
    scheduler.add_job(
        "app.jobs.conflict_jobs:auto_resolve_case",
        "date", run_date=deadline, args=[case_id],
        id=f"deadline-{case_id}", replace_existing=True, misfire_grace_time=3600,
    )


def cancel_conflict_timers(case_id: str) -> None:
    """Called when a case is resolved before its deadline fires."""
    for job_id in (f"reminder-{case_id}", f"deadline-{case_id}"):
        job = scheduler.get_job(job_id)
        if job:
            job.remove()