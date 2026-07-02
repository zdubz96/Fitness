import { sendMessage } from "../anthropic.js";
import { save } from "../state.js";
import { toast } from "../components/toast.js";

const SYSTEM_PROMPT = `You are a friendly, expert AI personal trainer running a first-time onboarding
interview with a new client, over chat. Ask about, a couple of things at a time (don't dump
every question at once):
- experience level with structured training
- injuries or physical limitations
- available equipment (home gym? commercial gym? bodyweight only?)
- weekly schedule / how many days and how much time they can train
- exercise preferences / things they enjoy or hate
- goals, including whether they have a cardiovascular goal (e.g. raise VO2 max, run a race)
- cardio history / current cardio fitness
- age, sex, and known max heart rate (if they know it; it's fine if they don't)

Keep messages short and conversational. Once you've covered all of the above, respond with
ONLY a JSON object (no markdown fences, no other text) wrapped exactly like this, with nothing
before or after it:
<PROFILE_JSON>{"experience_level": string, "injuries": string, "equipment": string, "schedule": string, "preferences": string, "goals": [{"text": string, "type": "strength"|"cardio"|"weight"|"other"}], "cardio_history": string, "age": number|null, "sex": string|null, "max_hr": number|null, "onboarding_complete": true}</PROFILE_JSON>
Do not emit that JSON until you genuinely have enough information across all the topics above.`;

export async function render(container, { onComplete }) {
  const messages = [];
  let sending = false;

  container.innerHTML = `
    <h1>Let's set up your training</h1>
    <p>A quick interview so your coach can personalize everything.</p>
    <div class="chat-log" id="chat-log"></div>
    <div class="chat-input-bar">
      <textarea id="chat-input" placeholder="Type your answer..." rows="1"></textarea>
      <button id="chat-send">Send</button>
    </div>
  `;

  const logEl = document.getElementById("chat-log");
  const inputEl = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send");

  function paintLog() {
    logEl.innerHTML = messages
      .filter((m) => m.role !== "system")
      .map((m) => `<div class="chat-msg ${m.role}">${escapeHtml(m.display ?? m.content)}</div>`)
      .join("");
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setSending(state) {
    sending = state;
    sendBtn.disabled = state;
    inputEl.disabled = state;
    sendBtn.textContent = state ? "..." : "Send";
  }

  async function askCoach() {
    setSending(true);
    try {
      const reply = await sendMessage(SYSTEM_PROMPT, messages.map(({ role, content }) => ({ role, content })));
      const match = reply.match(/<PROFILE_JSON>([\s\S]*?)<\/PROFILE_JSON>/);
      if (match) {
        const profile = JSON.parse(match[1]);
        await save("trainer_profile", profile, "chore: complete onboarding");
        messages.push({ role: "assistant", content: reply, display: "Great, that's everything I need! Setting up your dashboard now..." });
        paintLog();
        toast("Onboarding complete", "success");
        setTimeout(() => onComplete(), 900);
        return;
      }
      messages.push({ role: "assistant", content: reply });
      paintLog();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setSending(false);
    }
  }

  async function send() {
    const text = inputEl.value.trim();
    if (!text || sending) return;
    messages.push({ role: "user", content: text });
    inputEl.value = "";
    paintLog();
    await askCoach();
  }

  sendBtn.addEventListener("click", send);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  // Kick off the interview.
  messages.push({ role: "user", content: "Hi, I'm ready to start my onboarding interview." });
  paintLog();
  await askCoach();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
