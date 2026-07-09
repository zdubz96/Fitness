// Auth screen for the Supabase-backed multi-tenant version of the app: sign in, sign up
// (gated by invite code via the `signup` edge function), and password reset.
// NOT wired into js/app.js yet — this file exists for the cutover step described in
// docs/SUPABASE_SETUP.md. Once wired, js/app.js's route() should render this when there is
// no active Supabase session, instead of (or before) the current isConfigured() gate.
import { supabase } from "../supabase/client.js";
import { SUPABASE_URL } from "../supabase/config.js";
import { toast } from "../components/toast.js";

const SIGNUP_URL = `${SUPABASE_URL}/functions/v1/signup`;

export async function render(container, { onSignedIn } = {}) {
  let mode = "signin"; // signin | signup | reset

  paint();

  function paint() {
    container.innerHTML = `
      <div style="max-width:420px;margin:40px auto;padding:0 16px">
        <h1 style="text-align:center">AI Trainer</h1>
        <div class="card stack">
          <div class="row" style="gap:8px">
            <button class="${mode === "signin" ? "" : "secondary"}" id="tab-signin" style="flex:1">Sign in</button>
            <button class="${mode === "signup" ? "" : "secondary"}" id="tab-signup" style="flex:1">Sign up</button>
          </div>

          ${mode === "signin" ? signInForm() : ""}
          ${mode === "signup" ? signUpForm() : ""}
          ${mode === "reset" ? resetForm() : ""}

          <div id="auth-status"></div>

          ${mode === "signin" ? `<button class="ghost" id="to-reset">Forgot password?</button>` : ""}
          ${mode === "reset" ? `<button class="ghost" id="to-signin">Back to sign in</button>` : ""}
        </div>
        <p style="font-size:11px;color:var(--text-dim);text-align:center;margin-top:12px">
          By continuing you agree this is not medical advice. Consult a physician before starting
          any new training program. You train at your own risk.
        </p>
      </div>
    `;

    document.getElementById("tab-signin")?.addEventListener("click", () => { mode = "signin"; paint(); });
    document.getElementById("tab-signup")?.addEventListener("click", () => { mode = "signup"; paint(); });
    document.getElementById("to-reset")?.addEventListener("click", () => { mode = "reset"; paint(); });
    document.getElementById("to-signin")?.addEventListener("click", () => { mode = "signin"; paint(); });

    if (mode === "signin") wireSignIn();
    if (mode === "signup") wireSignUp();
    if (mode === "reset") wireReset();
  }

  function signInForm() {
    return `
      <label for="si-email">Email</label>
      <input id="si-email" type="email" autocomplete="email" />
      <label for="si-password">Password</label>
      <input id="si-password" type="password" autocomplete="current-password" />
      <button id="si-submit">Sign in</button>
    `;
  }

  function signUpForm() {
    return `
      <label for="su-code">Invite code</label>
      <input id="su-code" type="text" placeholder="XXXXXXXX" style="text-transform:uppercase" />
      <label for="su-email">Email</label>
      <input id="su-email" type="email" autocomplete="email" />
      <label for="su-password">Password</label>
      <input id="su-password" type="password" autocomplete="new-password" placeholder="At least 8 characters" />
      <button id="su-submit">Create account</button>
    `;
  }

  function resetForm() {
    return `
      <label for="rs-email">Email</label>
      <input id="rs-email" type="email" autocomplete="email" />
      <button id="rs-submit">Send reset link</button>
    `;
  }

  function setStatus(html) {
    document.getElementById("auth-status").innerHTML = html;
  }

  function wireSignIn() {
    document.getElementById("si-submit").addEventListener("click", async (e) => {
      const email = val("si-email");
      const password = val("si-password");
      if (!email || !password) return toast("Enter email and password", "error");
      e.target.disabled = true;
      e.target.textContent = "Signing in...";
      setStatus("");
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setStatus(`<p style="color:var(--bad);font-size:13px">${error.message}</p>`);
        e.target.disabled = false;
        e.target.textContent = "Sign in";
        return;
      }
      onSignedIn?.();
    });
  }

  function wireSignUp() {
    document.getElementById("su-submit").addEventListener("click", async (e) => {
      const code = val("su-code").toUpperCase();
      const email = val("su-email");
      const password = val("su-password");
      if (!code || !email || !password) return toast("Fill in all fields", "error");
      if (password.length < 8) return toast("Password must be at least 8 characters", "error");
      e.target.disabled = true;
      e.target.textContent = "Creating account...";
      setStatus("");
      try {
        const res = await fetch(SIGNUP_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password, code }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.detail || body.error || "Sign up failed");
        setStatus(
          `<p style="color:var(--good);font-size:13px">Account created — sign in below.</p>`
        );
        mode = "signin";
        setTimeout(paint, 1200);
      } catch (err) {
        setStatus(`<p style="color:var(--bad);font-size:13px">${err.message}</p>`);
        e.target.disabled = false;
        e.target.textContent = "Create account";
      }
    });
  }

  function wireReset() {
    document.getElementById("rs-submit").addEventListener("click", async (e) => {
      const email = val("rs-email");
      if (!email) return toast("Enter your email", "error");
      e.target.disabled = true;
      e.target.textContent = "Sending...";
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) {
        setStatus(`<p style="color:var(--bad);font-size:13px">${error.message}</p>`);
      } else {
        setStatus(`<p style="color:var(--good);font-size:13px">Check your email for a reset link.</p>`);
      }
      e.target.disabled = false;
      e.target.textContent = "Send reset link";
    });
  }

  function val(id) {
    return document.getElementById(id).value.trim();
  }
}
