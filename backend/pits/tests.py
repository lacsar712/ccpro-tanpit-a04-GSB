from django.db import IntegrityError, transaction
from django.test import Client, TestCase
from django.utils import timezone

from pits.auth import make_token
from pits.models import Pit, RestTicket, User, Yard
from pits.seed import seed_demo


def make_user(username, role):
    user = User(username=username, role=role)
    user.set_password("123456")
    user.save()
    return user


def auth(username):
    return {"HTTP_AUTHORIZATION": f"Bearer {make_token(username)}"}


class TanPitTestCase(TestCase):
    def setUp(self):
        self.yard = Yard.objects.create(name="南冈鞣场", village="青皮村")
        self.drained = Pit.objects.create(
            yard=self.yard, code="中-1", status=Pit.STATUS_DRAINED, row=1, col=0
        )
        self.drained.samples.create(ph=4.6, operator="worker")
        self.tanning = Pit.objects.create(
            yard=self.yard, code="东-1", status=Pit.STATUS_TANNING, row=0, col=0
        )
        self.tanning.samples.create(ph=4.2, operator="worker")
        self.admin = make_user("admin", "admin")
        self.worker = make_user("worker", "worker")
        self.client = Client()

    def post_status(self, pit, status, who="worker"):
        return self.client.post(
            f"/api/pits/{pit.id}/status",
            {"status": status},
            content_type="application/json",
            **auth(who),
        )

    def issue(self, pit, hours, who="worker"):
        return self.client.post(
            f"/api/pits/{pit.id}/tickets",
            {"hours": hours},
            content_type="application/json",
            **auth(who),
        )


class RefillGateTests(TanPitTestCase):
    def test_refill_blocked_without_ticket(self):
        res = self.post_status(self.drained, "fill")
        self.assertEqual(res.status_code, 400)
        self.drained.refresh_from_db()
        self.assertEqual(self.drained.status, Pit.STATUS_DRAINED)

    def test_refill_blocked_when_hours_short(self):
        self.drained.rest_tickets.create(hours=4, issued_by="worker")
        res = self.post_status(self.drained, "fill")
        self.assertEqual(res.status_code, 400)
        self.drained.refresh_from_db()
        self.assertEqual(self.drained.status, Pit.STATUS_DRAINED)

    def test_refill_ok_with_full_hours_ticket(self):
        self.drained.rest_tickets.create(hours=8, issued_by="worker")
        res = self.post_status(self.drained, "fill")
        self.assertEqual(res.status_code, 200)
        self.drained.refresh_from_db()
        self.assertEqual(self.drained.status, Pit.STATUS_FILL)

    def test_withdrawn_ticket_does_not_unlock_refill(self):
        self.drained.rest_tickets.create(
            hours=8, issued_by="worker", withdrawn_at=timezone.now()
        )
        res = self.post_status(self.drained, "fill")
        self.assertEqual(res.status_code, 400)

    def test_drain_and_sample_do_not_read_ticket(self):
        # 标已放液只看酸碱度，不读静置票（哪怕有张 1 小时的短票）
        self.tanning.rest_tickets.create(hours=1, issued_by="worker")
        res = self.post_status(self.tanning, "drained")
        self.assertEqual(res.status_code, 200)
        # 登记酸碱度也不读票
        res = self.client.post(
            f"/api/pits/{self.drained.id}/samples",
            {"ph": 4.9},
            content_type="application/json",
            **auth("worker"),
        )
        self.assertEqual(res.status_code, 200)


class TicketApiTests(TanPitTestCase):
    def test_worker_can_issue(self):
        res = self.issue(self.drained, 8)
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["hours"], 8)
        self.assertEqual(body["issuedBy"], "worker")
        self.assertIsNone(body["withdrawnAt"])

    def test_hours_must_be_positive_integer(self):
        self.assertEqual(self.issue(self.drained, 0).status_code, 400)
        self.assertEqual(self.issue(self.drained, -3).status_code, 400)
        self.assertEqual(RestTicket.objects.count(), 0)

    def test_second_active_ticket_rejected(self):
        self.assertEqual(self.issue(self.drained, 8).status_code, 200)
        res = self.issue(self.drained, 9, who="admin")
        self.assertEqual(res.status_code, 409)
        self.assertEqual(
            RestTicket.objects.filter(pit=self.drained, withdrawn_at__isnull=True).count(), 1
        )

    def test_unique_constraint_backstop(self):
        # 两人同时开票：数据库部分唯一索引兜底，库内只留一张未收回票
        self.drained.rest_tickets.create(hours=8, issued_by="worker")
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                self.drained.rest_tickets.create(hours=9, issued_by="admin")
        self.assertEqual(
            RestTicket.objects.filter(pit=self.drained, withdrawn_at__isnull=True).count(), 1
        )

    def test_withdraw_only_leader(self):
        ticket = self.drained.rest_tickets.create(hours=8, issued_by="worker")
        res = self.client.post(f"/api/tickets/{ticket.id}/withdraw", **auth("worker"))
        self.assertEqual(res.status_code, 403)
        ticket.refresh_from_db()
        self.assertIsNone(ticket.withdrawn_at)
        res = self.client.post(f"/api/tickets/{ticket.id}/withdraw", **auth("admin"))
        self.assertEqual(res.status_code, 200)
        ticket.refresh_from_db()
        self.assertIsNotNone(ticket.withdrawn_at)
        # 收回后该坑可再开票
        self.assertEqual(self.issue(self.drained, 8).status_code, 200)

    def test_list_and_filter(self):
        self.drained.rest_tickets.create(hours=8, issued_by="worker")
        self.tanning.rest_tickets.create(
            hours=4, issued_by="worker", withdrawn_at=timezone.now()
        )
        res = self.client.get("/api/tickets", **auth("worker"))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json()), 2)
        res = self.client.get(f"/api/tickets?pit_id={self.drained.id}", **auth("worker"))
        self.assertEqual([t["pitCode"] for t in res.json()], ["中-1"])
        res = self.client.get("/api/tickets?active=true", **auth("worker"))
        self.assertEqual(len(res.json()), 1)
        self.assertIsNone(res.json()[0]["withdrawnAt"])

    def test_board_carries_active_ticket(self):
        self.drained.rest_tickets.create(hours=8, issued_by="worker")
        res = self.client.get("/api/board", **auth("worker"))
        self.assertEqual(res.status_code, 200)
        pits = {p["code"]: p for p in res.json()["pits"]}
        self.assertEqual(pits["中-1"]["restTicket"]["hours"], 8)
        self.assertIsNone(pits["东-1"]["restTicket"])


class SeedTests(TestCase):
    def test_seed_one_drained_pit_zero_tickets(self):
        seed_demo()
        self.assertEqual(Pit.objects.filter(status=Pit.STATUS_DRAINED).count(), 1)
        self.assertEqual(RestTicket.objects.count(), 0)
