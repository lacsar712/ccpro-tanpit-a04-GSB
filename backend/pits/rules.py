"""鞣坑放液门槛：最近一次浸液酸碱度须在 3.5～5.0。
已放液坑拨回注液门槛：过夜簿须有该坑满 8 小时的未收回静置票。"""

from pits.models import Pit

MIN_PH = 3.5
MAX_PH = 5.0
MIN_REST_HOURS = 8


class RuleError(ValueError):
    pass


def latest_ph(pit: Pit) -> float | None:
    sample = pit.samples.order_by("-taken_at", "-id").first()
    return None if sample is None else sample.ph


def active_rest_ticket(pit: Pit):
    """该坑现行有效（未收回）的静置票，没有则 None。"""
    for ticket in pit.rest_tickets.all():
        if ticket.withdrawn_at is None:
            return ticket
    return None


def assert_can_set_status(pit: Pit, new_status: str) -> None:
    allowed = {Pit.STATUS_FILL, Pit.STATUS_TANNING, Pit.STATUS_DRAINED}
    if new_status not in allowed:
        raise RuleError(f"无效状态：{new_status}")
    if new_status == Pit.STATUS_DRAINED:
        ph = latest_ph(pit)
        if ph is None:
            raise RuleError("该坑尚无浸液酸碱记录，不能放液")
        if ph < MIN_PH or ph > MAX_PH:
            raise RuleError(f"最近酸碱度 {ph} 不在 {MIN_PH}～{MAX_PH}，不能放液")
    if pit.status == Pit.STATUS_DRAINED and new_status == Pit.STATUS_FILL:
        ticket = active_rest_ticket(pit)
        if ticket is None:
            raise RuleError("过夜簿没有未收回的静置票，不能拨回注液")
        if ticket.hours < MIN_REST_HOURS:
            raise RuleError(f"静置票 {ticket.hours} 小时不足 {MIN_REST_HOURS} 小时，不能拨回注液")
