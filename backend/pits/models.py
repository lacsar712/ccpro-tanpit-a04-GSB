from django.contrib.auth.hashers import check_password, make_password
from django.db import models


class User(models.Model):
    username = models.CharField(max_length=64, unique=True)
    password_hash = models.CharField(max_length=256)
    role = models.CharField(max_length=20, default="worker")

    def set_password(self, raw: str) -> None:
        self.password_hash = make_password(raw)

    def check_password(self, raw: str) -> bool:
        return check_password(raw, self.password_hash)


class Yard(models.Model):
    name = models.CharField(max_length=120)
    village = models.CharField(max_length=120, blank=True)


class Pit(models.Model):
    STATUS_FILL = "fill"
    STATUS_TANNING = "tanning"
    STATUS_DRAINED = "drained"

    yard = models.ForeignKey(Yard, on_delete=models.CASCADE, related_name="pits")
    code = models.CharField(max_length=40)
    status = models.CharField(max_length=20, default=STATUS_FILL)
    row = models.IntegerField(default=0)
    col = models.IntegerField(default=0)

    class Meta:
        unique_together = ("yard", "code")


class LiquorSample(models.Model):
    pit = models.ForeignKey(Pit, on_delete=models.CASCADE, related_name="samples")
    taken_at = models.DateTimeField(auto_now_add=True)
    ph = models.FloatField()
    operator = models.CharField(max_length=64, blank=True)


class RestTicket(models.Model):
    """过夜簿静置票：同一坑未收回的票至多一张（数据库部分唯一索引兜底）。"""

    pit = models.ForeignKey(Pit, on_delete=models.CASCADE, related_name="rest_tickets")
    hours = models.PositiveIntegerField()
    issued_at = models.DateTimeField(auto_now_add=True)
    issued_by = models.CharField(max_length=64)
    withdrawn_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(hours__gte=1), name="restticket_hours_positive"),
            models.UniqueConstraint(
                fields=["pit"],
                condition=models.Q(withdrawn_at__isnull=True),
                name="restticket_one_active_per_pit",
            ),
        ]
