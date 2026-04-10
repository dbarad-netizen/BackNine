from pydantic import BaseModel
from typing import Optional
from datetime import date

class WearableConnection(BaseModel):
    provider: str
    access_token: str
    refresh_token: Optional[str] = None
    expires_at: Optional[int] = None

class DailyMetrics(BaseModel):
    date: str
    readiness: Optional[int] = None
    sleep: Optional[int] = None
    activity: Optional[int] = None
    hrv: Optional[float] = None
    rhr: Optional[int] = None
    steps: Optional[int] = None
    total_hrs: Optional[float] = None
    temp_dev: Optional[float] = None
    deep_min: Optional[int] = None
    rem_min: Optional[int] = None
    efficiency: Optional[int] = None
    active_cal: Optional[int] = None

class CoachItem(BaseModel):
    icon: str
    title: str
    body: str
    urgency: str  # "good" | "warn" | "urgent" | "info"

class DashboardResponse(BaseModel):
    generated: str
    data_through: str
    provider: str
    today: dict
    trend: list[DailyMetrics]
    coaching: dict  # {short: [], mid: [], long: []}
    summary: str
