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

function fmtTime(iso) {
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
    view: { type: String },
    user: { type: Object },
    tickets: { type: Array },
    filterPit: { type: String },
    filterOpen: { type: Boolean },
    ticketPit: { type: String },
    ticketHours: { type: String },
  };

  static styles = css`
    :host { display: block; font-family: "KaiTi", serif; color: #2b2118; }
    .wrap { max-width: 880px; margin: 0 auto; padding: 28px 16px 50px; }
    nav { display: flex; align-items: center; gap: 8px; border-bottom: 2px solid #8a5a2b; padding-bottom: 10px; margin-bottom: 16px; }
    nav button.tab { border: 1px solid #8a5a2b; background: #fff; color: #8a5a2b; border-radius: 6px; }
    nav button.tab.on { background: #8a5a2b; color: #fff; }
    nav .who { margin-left: auto; color: #6b5a48; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .pit { min-height: 110px; border-radius: 8px; color: #fff; cursor: pointer; border: 0; }
    .fill { background: #6d8f9e; }
    .tanning { background: #8a5a2b; }
    .drained { background: #5f6f4a; }
    .err { color: #9b1c1c; }
    .hint { color: #6b5a48; font-size: 0.92em; }
    .bar { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 14px; margin: 10px 0; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 18px; }
    th, td { border: 1px solid #cbb99f; padding: 6px 10px; text-align: left; }
    th { background: #f3ead9; }
    .open { color: #9b1c1c; font-weight: bold; }
    label { display: block; margin: 8px 0; }
    .bar label { margin: 0; }
    input, button, select { font: inherit; padding: 8px 10px; margin: 4px 6px 4px 0; }
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
    this.view = "map";
    this.user = JSON.parse(localStorage.getItem(USER_KEY) || "null");
    this.tickets = [];
    this.filterPit = "";
    this.filterOpen = false;
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
    } catch (e) {
      this.logout();
      return;
    }
    await this.refresh();
  }

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.ready = false;
    this.user = null;
    this.board = null;
  }

  async refresh() {
    try {
      this.board = await api("/api/board");
      if (this.picked) {
        this.picked = this.board.pits.find((p) => p.id === this.picked.id) || this.board.pits[0];
      }
      if (this.view === "book") await this.fetchTickets();
    } catch (e) {
      this.err = e.message;
    }
  }

  async fetchTickets() {
    const q = new URLSearchParams();
    if (this.filterPit) q.set("pit_id", this.filterPit);
    if (this.filterOpen) q.set("active", "true");
    this.tickets = await api(`/api/tickets?${q}`);
  }

  async setView(view) {
    this.view = view;
    this.err = "";
    if (view === "book" && this.board) await this.fetchTickets();
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
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
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

  async issueTicket() {
    this.err = "";
    const pitId = this.ticketPit || (this.board && this.board.pits[0] && this.board.pits[0].id);
    const hours = Number(this.ticketHours);
    if (!pitId) return;
    if (!Number.isInteger(hours) || hours < 1) {
      this.err = "静置小时须为正整数";
      return;
    }
    try {
      await api(`/api/pits/${pitId}/tickets`, { method: "POST", body: JSON.stringify({ hours }) });
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  async withdrawTicket(ticket) {
    this.err = "";
    try {
      await api(`/api/tickets/${ticket.id}/withdraw`, { method: "POST" });
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  renderNav() {
    return html`<nav>
      <button class="tab ${this.view === "map" ? "on" : ""}" @click=${() => this.setView("map")}>坑位场地图</button>
      <button class="tab ${this.view === "book" ? "on" : ""}" @click=${() => this.setView("book")}>过夜簿</button>
      <span class="who">${this.user ? `${this.user.username} · ${ROLE_LABELS[this.user.role] || this.user.role}` : ""}</span>
      <button class="tab" @click=${this.logout}>退出</button>
    </nav>`;
  }

  renderMap() {
    return html`
      <p>${this.board.village} · 点坑登记浸液酸碱度；放液须最近读数 3.5～5.0</p>
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
            <p>
              静置票：${this.picked.restTicket
                ? html`<span class="open">${this.picked.restTicket.hours} 小时</span>
                    · ${this.picked.restTicket.issuedBy} 开于 ${fmtTime(this.picked.restTicket.issuedAt)}`
                : "无未收回票"}
            </p>
            <p class="hint">已放液坑拨回注液，须过夜簿有该坑满 8 小时的未收回静置票</p>
            <input .value=${this.ph} @input=${(e) => (this.ph = e.target.value)} />
            <button @click=${this.writePh}>登记酸碱度</button>
            <div>
              <button @click=${() => this.setStatus("fill")}>注液</button>
              <button @click=${() => this.setStatus("tanning")}>鞣制中</button>
              <button @click=${() => this.setStatus("drained")}>已放液</button>
            </div>
          </section>`
        : ""}`;
  }

  renderBook() {
    const byPit = new Map();
    for (const t of this.tickets) {
      if (!byPit.has(t.pitId)) byPit.set(t.pitId, []);
      byPit.get(t.pitId).push(t);
    }
    const groups = this.board.pits.filter((p) => byPit.has(p.id));
    const isLeader = this.user && this.user.role === "admin";
    return html`<section>
      <h2>过夜簿 · 静置票</h2>
      <p class="hint">同一坑未收回票至多一张；已放液坑拨回注液须满 8 小时未收回票。操作工可开票，收回归班长。</p>
      <div class="bar">
        <label>坑位
          <select @change=${(e) => { this.filterPit = e.target.value; this.fetchTickets(); }}>
            <option value="">全部</option>
            ${this.board.pits.map(
              (p) => html`<option value=${p.id} ?selected=${String(p.id) === this.filterPit}>${p.code}</option>`
            )}
          </select>
        </label>
        <label><input type="checkbox" .checked=${this.filterOpen}
          @change=${(e) => { this.filterOpen = e.target.checked; this.fetchTickets(); }} /> 只看未收回</label>
      </div>
      <div class="bar">
        <label>开票坑位
          <select @change=${(e) => (this.ticketPit = e.target.value)}>
            ${this.board.pits.map(
              (p) => html`<option value=${p.id} ?selected=${String(p.id) === (this.ticketPit || String(this.board.pits[0].id))}>${p.code}</option>`
            )}
          </select>
        </label>
        <label>静置小时
          <input type="number" min="1" step="1" .value=${this.ticketHours} @input=${(e) => (this.ticketHours = e.target.value)} />
        </label>
        <button @click=${this.issueTicket}>开票</button>
      </div>
      ${groups.length === 0 ? html`<p class="hint">暂无静置票</p>` : ""}
      ${groups.map(
        (p) => html`<h3>${p.code} · ${LABELS[p.status]}</h3>
          <table>
            <tr><th>小时</th><th>开票时刻</th><th>开票人</th><th>收回时刻</th><th>操作</th></tr>
            ${byPit.get(p.id).map(
              (t) => html`<tr>
                <td>${t.hours}</td>
                <td>${fmtTime(t.issuedAt)}</td>
                <td>${t.issuedBy}</td>
                <td>${t.withdrawnAt ? fmtTime(t.withdrawnAt) : html`<span class="open">未收回</span>`}</td>
                <td>
                  ${!t.withdrawnAt && isLeader
                    ? html`<button @click=${() => this.withdrawTicket(t)}>收回</button>`
                    : !t.withdrawnAt
                      ? html`<span class="hint">待班长收回</span>`
                      : "—"}
                </td>
              </tr>`
            )}
          </table>`
      )}
    </section>`;
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
    if (!this.board) return html`<div class="wrap">${this.err || "装载坑位…"}</div>`;
    return html`<div class="wrap">
      ${this.renderNav()}
      <h1>${this.board.yard}</h1>
      ${this.view === "map" ? this.renderMap() : this.renderBook()}
      ${this.err ? html`<p class="err">${this.err}</p>` : ""}
    </div>`;
  }
}

customElements.define("tan-yard", TanYard);
