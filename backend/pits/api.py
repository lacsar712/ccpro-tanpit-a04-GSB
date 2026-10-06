from django.db import IntegrityError
from django.utils import timezone
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from pits.auth import BearerAuth, make_token
from pits.models import Pit, RestTicket, User, Yard
from pits.rules import RuleError, active_rest_ticket, assert_can_set_status, latest_ph

api = NinjaAPI(title="TanPit", urls_namespace="tanpit")
auth = BearerAuth()


class LoginIn(Schema):
    username: str
    password: str


class SampleIn(Schema):
    ph: float


class StatusIn(Schema):
    status: str


class TicketIn(Schema):
    hours: int


def ticket_json(ticket: RestTicket, pit: Pit | None = None) -> dict:
    pit = pit if pit is not None else ticket.pit
    return {
        "id": ticket.id,
        "pitId": ticket.pit_id,
        "pitCode": pit.code,
        "hours": ticket.hours,
        "issuedAt": ticket.issued_at.isoformat(),
        "issuedBy": ticket.issued_by,
        "withdrawnAt": ticket.withdrawn_at.isoformat() if ticket.withdrawn_at else None,
    }


def pit_json(pit: Pit) -> dict:
    ticket = active_rest_ticket(pit)
    return {
        "id": pit.id,
        "code": pit.code,
        "status": pit.status,
        "row": pit.row,
        "col": pit.col,
        "latestPh": latest_ph(pit),
        "sampleCount": pit.samples.count(),
        "restTicket": ticket_json(ticket, pit) if ticket else None,
    }


@api.post("/auth/login")
def login(request, payload: LoginIn):
    user = User.objects.filter(username=payload.username).first()
    if user is None or not user.check_password(payload.password):
        raise HttpError(401, "用户名或密码错误")
    return {"access_token": make_token(user.username), "user": {"username": user.username, "role": user.role}}


@api.get("/auth/me", auth=auth)
def me(request):
    user = request.auth
    return {"username": user.username, "role": user.role}


@api.get("/health")
def health(request):
    return {"status": "ok", "service": "TanPit"}


@api.get("/board", auth=auth)
def board(request):
    yard = Yard.objects.prefetch_related("pits__samples", "pits__rest_tickets").first()
    if yard is None:
        raise HttpError(404, "尚无鞣场")
    pits = sorted(yard.pits.all(), key=lambda p: (p.row, p.col))
    return {"yard": yard.name, "village": yard.village, "pits": [pit_json(p) for p in pits]}


@api.post("/pits/{pit_id}/samples", auth=auth)
def add_sample(request, pit_id: int, payload: SampleIn):
    pit = Pit.objects.filter(id=pit_id).first()
    if pit is None:
        raise HttpError(404, "坑不存在")
    pit.samples.create(ph=payload.ph, operator=request.auth.username)
    pit.refresh_from_db()
    return pit_json(pit)


@api.post("/pits/{pit_id}/status", auth=auth)
def set_status(request, pit_id: int, payload: StatusIn):
    pit = Pit.objects.filter(id=pit_id).first()
    if pit is None:
        raise HttpError(404, "坑不存在")
    try:
        assert_can_set_status(pit, payload.status)
    except RuleError as exc:
        raise HttpError(400, str(exc))
    pit.status = payload.status
    pit.save(update_fields=["status"])
    return pit_json(pit)


@api.get("/tickets", auth=auth)
def list_tickets(request, pit_id: int | None = None, active: bool | None = None):
    tickets = RestTicket.objects.select_related("pit").order_by("pit__row", "pit__col", "-issued_at", "-id")
    if pit_id is not None:
        tickets = tickets.filter(pit_id=pit_id)
    if active is not None:
        tickets = tickets.filter(withdrawn_at__isnull=active)
    return [ticket_json(t) for t in tickets]


@api.post("/pits/{pit_id}/tickets", auth=auth)
def issue_ticket(request, pit_id: int, payload: TicketIn):
    pit = Pit.objects.filter(id=pit_id).first()
    if pit is None:
        raise HttpError(404, "坑不存在")
    if payload.hours < 1:
        raise HttpError(400, "静置小时须为正整数")
    if active_rest_ticket(pit) is not None:
        raise HttpError(409, "该坑已有未收回的静置票")
    try:
        ticket = pit.rest_tickets.create(hours=payload.hours, issued_by=request.auth.username)
    except IntegrityError:
        # 两人同时开票撞数据库部分唯一索引，只留先落库的那张
        raise HttpError(409, "该坑已有未收回的静置票")
    return ticket_json(ticket, pit)


@api.post("/tickets/{ticket_id}/withdraw", auth=auth)
def withdraw_ticket(request, ticket_id: int):
    if request.auth.role != "admin":
        raise HttpError(403, "静置票收回归班长")
    ticket = RestTicket.objects.filter(id=ticket_id).first()
    if ticket is None:
        raise HttpError(404, "静置票不存在")
    if ticket.withdrawn_at is not None:
        raise HttpError(400, "该票已收回")
    ticket.withdrawn_at = timezone.now()
    ticket.save(update_fields=["withdrawn_at"])
    return ticket_json(ticket)
