# TanPit-01 · 南冈鞣场

鞣坑场地图作业台。登录后是按行列铺开的坑位，点坑登记浸液酸碱度并改状态。

## 技术栈

| 层 | 技术 |
| --- | --- |
| Web API | Django 5 · Django Ninja（不是 DRF 视图集） |
| 结构 | Django app `pits`：models / rules / api 分文件 |
| 数据 | Django ORM · PostgreSQL 15 |
| 前端 | Lit 3 Web Component · Vite |
| 部署 | Docker Compose |

## 路径与端口

- 前端：http://localhost:4770
- API：http://localhost:8770
- PostgreSQL：localhost:6170

## 演示账号

`admin` / `123456`，`worker` / `123456`

## 业务规则

坑不可标「已放液」，除非最近一次浸液酸碱度在 **3.5～5.0**。规则在 `backend/pits/rules.py`。

顶栏分「坑位场地图」与「过夜簿」两页。过夜簿按坑列出静置票（正整数小时、开票时刻与开票人、可空收回时刻），可筛、可开票；同一坑未收回票至多一张（数据库部分唯一索引兜底，两人同时开票只留一张）。操作工可开票，收回归班长（admin）。

已放液坑要点「注液」拨回时，须过夜簿有该坑**满 8 小时**的未收回静置票，没有或小时不够则挡住；登记酸碱度、标已放液都不读这张票。种子数据为一坑已放液、零张票。

## 快速启动

```bash
cd TanPit/TanPit-01
docker compose up --build
```
