# AI Assistance Disclosure
# Tool: Cursor (Auto), date: 2026-11-09
# Scope: Implementation assistance for Admin Service application services under author-fixed requirements and architecture.
# Author review: Sahana Avantika generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.

from datetime import datetime, timedelta, timezone

from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config import settings

_jobstore_url = settings.sync_database_url

scheduler: AsyncIOScheduler | None = None


def start() -> None:
    global scheduler
    scheduler = AsyncIOScheduler(jobstores={"default": SQLAlchemyJobStore(url=_jobstore_url)})
    scheduler.start()


def schedule_ai_reassessment(case_id: str) -> None:
    """One-off job from the review dialog. Replaces a rerun that has not started yet."""
    scheduler.add_job(
        "app.jobs.conflict_jobs:rerun_ai_evaluation",
        "date",
        run_date=datetime.now(timezone.utc),
        args=[case_id],
        id=f"ai-rerun-{case_id}",
        replace_existing=True,
        misfire_grace_time=3600,
    )


def schedule_appeal_reassessment(appeal_id: str) -> None:
    """One-off job from the appeal queue. Replaces a rerun that has not started yet."""
    scheduler.add_job(
        "app.jobs.appeal_jobs:rerun_appeal_evaluation",
        "date",
        run_date=datetime.now(timezone.utc),
        args=[appeal_id],
        id=f"appeal-rerun-{appeal_id}",
        replace_existing=True,
        misfire_grace_time=3600,
    )


def schedule_report_reassessment(report_id: str) -> None:
    """One-off job from the report queue. Replaces a rerun that has not started yet."""
    scheduler.add_job(
        "app.jobs.report_jobs:rerun_report_evaluation",
        "date",
        run_date=datetime.now(timezone.utc),
        args=[report_id],
        id=f"report-rerun-{report_id}",
        replace_existing=True,
        misfire_grace_time=3600,
    )


def schedule_report_evaluation(report_id: str) -> None:
    """One-off durable job: assess the report right after it is saved."""
    scheduler.add_job(
        "app.jobs.report_jobs:run_report_evaluation",
        "date",
        run_date=datetime.now(timezone.utc),
        args=[report_id],
        id=f"report-ai-{report_id}",
        replace_existing=True,
        misfire_grace_time=3600,
    )


def schedule_appeal_evaluation(appeal_id: str) -> None:
    """One-off durable job: assess the appeal right after it is saved."""
    scheduler.add_job(
        "app.jobs.appeal_jobs:run_appeal_evaluation",
        "date",
        run_date=datetime.now(timezone.utc),
        args=[appeal_id],
        id=f"appeal-ai-{appeal_id}",
        replace_existing=True,
        misfire_grace_time=3600,
    )


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


def conflict_job_ids(case_id: str) -> tuple[str, ...]:
    """Durable APScheduler ids tied to one conflict case."""
    return (
        f"reminder-{case_id}",
        f"deadline-{case_id}",
        f"ai-{case_id}",
        f"ai-rerun-{case_id}",
    )


def cancel_conflict_timers(case_id: str) -> None:
    """Called when a case is resolved before its deadline fires."""
    for job_id in (f"reminder-{case_id}", f"deadline-{case_id}"):
        job = scheduler.get_job(job_id)
        if job:
            job.remove()
