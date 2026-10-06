import { LitElement, css, html } from "lit";

const TOKEN_KEY = "tanpit_token";
const USER_KEY = "tanpit_user";
const LABELS = { fill: "注液", tanning: "鞣制中", drained: "已放液" };
const ROLE_LABELS = { admin: "班长", worker: "操作工" };

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "请求失败");
  return data;
}

function fmt(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

class TanYard extends LitElement {
  static properties = {
    ready: { type: Boolean },
    board: { type: Object },
    picked: { type: Object },
    ph: { type: String },
    err: { type: String },
    username: { type: String },
    password: { type: String },
    user: { type: Object },
    view: { type: String },
    tickets: { type: Array },
    filterPit: { type: String },
    onlyActive: { type: Boolean },
    ticketPit: { type: String },
    ticketHours: { type: String },
  };

  static styles = css`
    :host { display: block; font-family: "KaiTi", serif; color: #2b2118; }
    .topbar { display: flex; align-items: center; gap: 14px; background: #3a2c1e; color: #f3e9d7; padding: 10px 18px; }
    .topbar .brand { font-size: 1.15em; font-weight: bold; }
    .topbar nav { display: flex; gap: 6px; }
    .topbar nav button { background: transparent; color: #d8c7a8; border: 1px solid #6b5638; border-radius: 6px; padding: 6px 14px; cursor: pointer; }
    .topbar nav button.on { background: #8a5a2b; color: #fff; border-color: #8a5a2b; }
    .topbar .who { margin-left: auto; font-size: 0.92em; }
    .topbar .who button { background: transparent; color: #d8c7a8; border: 1px solid #6b5638; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
    .wrap { max-width: 880px; margin: 0 auto; padding: 28px 16px 50px; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .pit { min-height: 110px; border-radius: 8px; color: #fff; cursor: pointer; border: 0; }
    .fill { background: #6d8f9e; }
    .tanning { background: #8a5a2b; }
    .drained { background: #5f6f4a; }
    .err { color: #9b1c1c; }
    .hint { color: #6b5a48; font-size: 0.92em; }
    .ticket-line { color: #4a3a22; }
    label { display: inline-block; margin: 8px 12px 8px 0; }
    input, button, select { font: inherit; padding: 8px 10px; margin: 4px 6px 4px 0; }
    table { border-collapse: collapse; width: 100%; margin-top: 12px; }
    th, td { border: 1px solid #cbb894; padding: 8px 10px; text-align: left; }
    th { background: #efe4cc; }
    tr.done td { color: #8a7a62; }
    .bar { margin: 10px 0; }
    .newticket { background: #f5edd9; border: 1px solid #d8c7a8; border-radius: 8px; padding: 10px 14px; margin: 12px 0; }
  `;

  constructor() {
    super();
    this.ready = Boolean(localStorage.getItem(TOKEN_KEY));
    this.board = null;
    this.picked = null;
    this.ph = "4.2";
    this.err = "";
    this.username = "admin";
    this.password = "123456";
    this.user = null;
    this.view = "board";
    this.tickets = [];
    this.filterPit = "";
    this.onlyActive = false;
    this.ticketPit = "";
    this.ticketHours = "8";
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.ready) this.boot();
  }

  async boot() {
    try {
      this.user = await api("/api/auth/me");
      localStorage.setItem(USER_KEY, JSON.stringify(this.user));
      await Promise.all([this.refresh(), this.loadTickets()]);
    } catch (e) {
      this.logout();
    }
  }

  async refresh() {
    try {
      this.board = await api("/api/board");
      if (!this.ticketPit && this.board.pits.length) this.ticketPit = String(this.board.pits[0].id);
      if (this.picked) {
        this.picked = this.board.pits.find((p) => p.id === this.picked.id) || this.board.pits[0];
      }
    } catch (e) {
      this.err = e.message;
    }
  }

  async loadTickets() {
    try {
      const data = await api("/api/tickets");
      this.tickets = data.tickets;
    } catch (e) {
      this.err = e.message;
    }
  }

  async login(e) {
    e.preventDefault();
    this.err = "";
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: this.username, password: this.password }),
      });
      localStorage.setItem(TOKEN_KEY, data.access_token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      this.user = data.user;
      this.ready = true;
      await Promise.all([this.refresh(), this.loadTickets()]);
    } catch (ex) {
      this.err = ex.message;
    }
  }

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.ready = false;
    this.user = null;
    this.board = null;
    this.picked = null;
    this.tickets = [];
    this.view = "board";
    this.err = "";
  }

  switchView(view) {
    this.view = view;
    this.err = "";
    if (view === "book") this.loadTickets();
  }

  async writePh() {
    this.err = "";
    try {
      this.picked = await api(`/api/pits/${this.picked.id}/samples`, {
        method: "POST",
        body: JSON.stringify({ ph: Number(this.ph) }),
      });
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  async setStatus(status) {
    this.err = "";
    try {
      this.picked = await api(`/api/pits/${this.picked.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  async createTicket() {
    this.err = "";
    try {
      await api(`/api/pits/${this.ticketPit}/tickets`, {
        method: "POST",
        body: JSON.stringify({ hours: Number(this.ticketHours) }),
      });
      await Promise.all([this.loadTickets(), this.refresh()]);
    } catch (ex) {
      this.err = ex.message;
    }
  }

  async withdrawTicket(ticket) {
    this.err = "";
    try {
      await api(`/api/tickets/${ticket.id}/withdraw`, { method: "POST" });
      await Promise.all([this.loadTickets(), this.refresh()]);
    } catch (ex) {
      this.err = ex.message;
    }
  }

  get filteredTickets() {
    return this.tickets.filter(
      (t) =>
        (!this.filterPit || t.pitId === Number(this.filterPit)) &&
        (!this.onlyActive || !t.withdrawnAt)
    );
  }

  renderTopbar() {
    return html`<header class="topbar">
      <span class="brand">南冈鞣场</span>
      <nav>
        <button class=${this.view === "board" ? "on" : ""} @click=${() => this.switchView("board")}>坑位场地图</button>
        <button class=${this.view === "book" ? "on" : ""} @click=${() => this.switchView("book")}>过夜簿</button>
      </nav>
      <span class="who">
        ${this.user ? html`${this.user.username}（${ROLE_LABELS[this.user.role] || this.user.role}）` : ""}
        <button @click=${this.logout}>退出</button>
      </span>
    </header>`;
  }

  renderBoard() {
    if (!this.board) return html`<div class="wrap">${this.err || "装载坑位…"}</div>`;
    return html`<div class="wrap">
      <p>${this.board.village} · 点坑登记浸液酸碱度；放液须最近读数 3.5～5.0；已放液拨回注液须凭满 8 小时未收回的静置票</p>
      <div class="grid">
        ${this.board.pits.map(
          (p) => html`<button class="pit ${p.status}" @click=${() => (this.picked = p)}>
            <strong>${p.code}</strong><br />${LABELS[p.status]}
          </button>`
        )}
      </div>
      ${this.picked
        ? html`<section>
            <h3>${this.picked.code} · ${LABELS[this.picked.status]}</h3>
            <p>最近酸碱度：${this.picked.latestPh ?? "无"} · ${this.picked.sampleCount} 次</p>
            <p class="ticket-line">静置票：${this.picked.activeTicket
              ? html`${this.picked.activeTicket.hours} 小时 · ${this.picked.activeTicket.createdBy} 开于 ${fmt(this.picked.activeTicket.createdAt)}`
              : "无未收回静置票"}</p>
            <input .value=${this.ph} @input=${(e) => (this.ph = e.target.value)} />
            <button @click=${this.writePh}>登记酸碱度</button>
            <div>
              <button @click=${() => this.setStatus("fill")}>注液</button>
              <button @click=${() => this.setStatus("tanning")}>鞣制中</button>
              <button @click=${() => this.setStatus("drained")}>已放液</button>
            </div>
          </section>`
        : ""}
      ${this.err ? html`<p class="err">${this.err}</p>` : ""}
    </div>`;
  }

  renderBook() {
    const pits = this.board ? this.board.pits : [];
    const rows = this.filteredTickets;
    return html`<div class="wrap">
      <h2>过夜簿 · 静置票</h2>
      <div class="bar">
        <label>坑位
          <select .value=${this.filterPit} @change=${(e) => (this.filterPit = e.target.value)}>
            <option value="">全部</option>
            ${pits.map((p) => html`<option value=${p.id}>${p.code}</option>`)}
          </select>
        </label>
        <label><input type="checkbox" .checked=${this.onlyActive} @change=${(e) => (this.onlyActive = e.target.checked)} /> 只看未收回</label>
      </div>
      <div class="newticket">
        <strong>开票</strong>
        <label>坑位
          <select .value=${this.ticketPit} @change=${(e) => (this.ticketPit = e.target.value)}>
            ${pits.map((p) => html`<option value=${p.id}>${p.code}</option>`)}
          </select>
        </label>
        <label>静置小时
          <input type="number" min="1" step="1" style="width:6em" .value=${this.ticketHours} @input=${(e) => (this.ticketHours = e.target.value)} />
        </label>
        <button @click=${this.createTicket}>开票</button>
        <p class="hint">同一坑同时只能有一张未收回的票；满 8 小时才让已放液坑拨回注液。收回归班长。</p>
      </div>
      ${rows.length
        ? html`<table>
            <thead><tr><th>坑位</th><th>小时</th><th>开票人</th><th>开票时刻</th><th>收回时刻</th><th>操作</th></tr></thead>
            <tbody>
              ${rows.map(
                (t) => html`<tr class=${t.withdrawnAt ? "done" : ""}>
                  <td>${t.pitCode}</td>
                  <td>${t.hours}</td>
                  <td>${t.createdBy}</td>
                  <td>${fmt(t.createdAt)}</td>
                  <td>${t.withdrawnAt ? fmt(t.withdrawnAt) : "未收回"}</td>
                  <td>${!t.withdrawnAt && this.user && this.user.role === "admin"
                    ? html`<button @click=${() => this.withdrawTicket(t)}>收回</button>`
                    : ""}</td>
                </tr>`
              )}
            </tbody>
          </table>`
        : html`<p class="hint">暂无静置票</p>`}
      ${this.err ? html`<p class="err">${this.err}</p>` : ""}
    </div>`;
  }

  render() {
    if (!this.ready) {
      return html`<div class="wrap">
        <h1>南冈鞣场</h1>
        <form @submit=${this.login} autocomplete="off">
          <label>用户名
            <input name="username" autocomplete="off" .value=${this.username} @input=${(e) => (this.username = e.target.value)} />
          </label>
          <label>密码
            <input name="password" type="password" autocomplete="off" .value=${this.password} @input=${(e) => (this.password = e.target.value)} />
          </label>
          <p class="hint">已预填 admin / 123456，另有 worker / 123456</p>
          <button>登录</button>
        </form>
        ${this.err ? html`<p class="err">${this.err}</p>` : ""}
      </div>`;
    }
    return html`
      ${this.renderTopbar()}
      ${this.view === "board" ? this.renderBoard() : this.renderBook()}
    `;
  }
}

customElements.define("tan-yard", TanYard);
