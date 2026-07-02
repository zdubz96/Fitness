import { getLocal, refresh, save } from "../state.js";
import { sendMessage } from "../anthropic.js";
import { buildCoachContext, contextToPromptText } from "../lib/context.js";
import { toast } from "../components/toast.js";

const SUMMARIZE_THRESHOLD = 40; // messages
const KEEP_RECENT = 16;

function systemPrompt(ctx) {
  return `You are the client's ongoing AI personal trainer, chatting with them anytime — about
form questions, soreness, exercise swaps, motivation, or anything training-related. Be warm,
direct, and concrete. Use the context below (their profile, goals, recent Garmin data, recent
logs, today's planned workout, recovery indicators, latest weekly review) to ground your
answers. Proactively flag accumulating fatigue if the recovery indicators warrant it, even if
not asked. Keep replies conversational — a few sentences, not an essay, unless they ask for
depth.

${contextToPromptText(ctx)}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

export async function render(container) {
  let chat = getLocal("coach_chats");
  let sending = false;

  paint();
  refresh("coach_chats").then((c) => { chat = c; paint(); }).catch(() => {});

  function paint() {
    container.innerHTML = `
      <h1>Coach</h1>
      <div class="chat-log" id="chat-log"></div>
      <div class="chat-input-bar">
        <textarea id="chat-input" placeholder="Ask your coach anything..." rows="1"></textarea>
        <button id="chat-send">Send</button>
      </div>
    `;
    const logEl = document.getElementById("chat-log");
    logEl.innerHTML = chat.length
      ? chat.map((m) => `<div class="chat-msg ${m.role}">${escapeHtml(m.content)}</div>`).join("")
      : `<p>Ask about form, soreness, motivation, or anything else. Your coach has your full recent training context.</p>`;
    logEl.scrollTop = logEl.scrollHeight;

    const inputEl = document.getElementById("chat-input");
    const sendBtn = document.getElementById("chat-send");
    sendBtn.addEventListener("click", () => send(inputEl, sendBtn));
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send(inputEl, sendBtn);
      }
    });
  }

  async function send(inputEl, sendBtn) {
    if (sending) return;
    const text = inputEl.value.trim();
    if (!text) return;
    sending = true;
    sendBtn.disabled = true;
    inputEl.disabled = true;

    const userMsg = { role: "user", content: text, at: new Date().toISOString() };
    chat = [...chat, userMsg];
    paint();

    try {
      const ctx = buildCoachContext();
      const history = chat.slice(-KEEP_RECENT).map(({ role, content }) => ({ role, content }));
      const reply = await sendMessage(systemPrompt(ctx), history, { maxTokens: 1024 });
      const assistantMsg = { role: "assistant", content: reply, at: new Date().toISOString() };
      chat = [...chat, assistantMsg];
      await maybeSummarize();
      await save("coach_chats", chat, "chore: coach chat");
      paint();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      sending = false;
    }
  }

  async function maybeSummarize() {
    if (chat.length <= SUMMARIZE_THRESHOLD) return;
    const toSummarize = chat.slice(0, chat.length - KEEP_RECENT);
    const recent = chat.slice(chat.length - KEEP_RECENT);
    try {
      const summaryText = await sendMessage(
        "Summarize this coaching conversation history into a short paragraph (key facts, ongoing issues, preferences, decisions) for the trainer's own notes. Be concise.",
        [{ role: "user", content: toSummarize.map((m) => `${m.role}: ${m.content}`).join("\n") }],
        { maxTokens: 512 }
      );
      const profile = getLocal("trainer_profile") || {};
      const nextProfile = {
        ...profile,
        chat_summary: [profile.chat_summary, summaryText].filter(Boolean).join("\n\n---\n\n"),
      };
      await save("trainer_profile", nextProfile, "chore: summarize old coach chat into profile");
      chat = recent;
    } catch (e) {
      console.warn("chat summarization failed, keeping full history", e);
    }
  }
}
