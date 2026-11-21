import { api } from "../api.js";
import { bootstrap } from "../store.js";
import { esc, showToast } from "../utils.js";

export function renderAuth(container) {
  const params = new URLSearchParams(window.location.search);
  const urlInvite = params.get("invite") || "";
  let mode = urlInvite ? "register" : "login";

  function paint() {
    container.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-panel">
          <div class="auth-brand">
            <img class="rail-logo" src="/src/brand/xianxing-180.png" width="36" height="36" alt="" />
            <div>
              <h1 class="auth-title">先行</h1>
              
            </div>
          </div>

          <div class="segmented" role="tablist" style="width:100%;">
            <button type="button" class="segmented-btn" style="flex:1;" data-auth-mode="login" aria-selected="${mode === "login"}">登录账号</button>
            <button type="button" class="segmented-btn" style="flex:1;" data-auth-mode="register" aria-selected="${mode === "register"}">邀请注册</button>
          </div>

          <div id="auth-error"></div>

          <form id="auth-form" style="display:grid;gap:12px;">
            <label class="field">
              <span class="field-label">账号名称</span>
              <input class="input" name="name" required autocomplete="username" placeholder="例如 owner" />
            </label>
            <label class="field">
              <span class="field-label">密码${mode === "register" ? "（至少 10 位）" : ""}</span>
              <input class="input" type="password" name="password" required minlength="10" autocomplete="${mode === "login" ? "current-password" : "new-password"}" placeholder="输入密码" />
            </label>
            ${
              mode === "register"
                ? `
              <label class="field">
                <span class="field-label">邀请码</span>
                <input class="input mono" name="token" required value="${esc(urlInvite)}" placeholder="粘贴工作台或比赛邀请码" />
              </label>
            `
                : ""
            }
            <button type="submit" class="btn btn--primary" style="height:38px;margin-top:4px;">
              ${mode === "login" ? "进入工作台" : "注册并进入"}
            </button>
          </form>

          <div style="font-size:var(--text-xs);color:var(--ink-muted);line-height:1.55;">
            使用已有账号登录，或凭邀请注册。
          </div>
        </div>
      </div>
    `;

    container.querySelectorAll("[data-auth-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        mode = btn.dataset.authMode;
        paint();
      });
    });

    const form = container.querySelector("#auth-form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const name = String(fd.get("name") || "").trim();
      const password = String(fd.get("password") || "");
      const token = String(fd.get("token") || "").trim();
      const errBox = container.querySelector("#auth-error");
      const submitBtn = form.querySelector('button[type="submit"]');
      errBox.innerHTML = "";
      submitBtn.disabled = true;
      try {
        if (mode === "login") {
          await api.login(name, password);
          if (urlInvite) {
            try {
              await api.join(urlInvite);
              showToast("已登录并加入邀请的比赛项目");
            } catch {
              // Ignore if workspace invite rather than contest invite
            }
          }
        } else {
          await api.register(name, password, token);
          showToast("注册成功，欢迎使用先行");
        }
        if (urlInvite) {
          history.replaceState({}, "", "/");
        }
        await bootstrap();
      } catch (err) {
        errBox.innerHTML = `<div class="banner banner--danger">${esc(err.message)}</div>`;
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  paint();
}
