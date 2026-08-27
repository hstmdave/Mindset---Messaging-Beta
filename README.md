# Mindset → Salesforce Messaging Beta

Hands a customer conversation off from a Mindset AI agent to a Salesforce live
agent, carrying the AI's context across so the human representative opens the
chat already knowing the story.

The Mindset agent is the only chat the customer sees. When it decides they need a
person, it opens the Salesforce Embedded Messaging chat and steps aside.

---

## Files

| File | What it is |
|---|---|
| `index.md` | The original Salesforce Embedded Messaging snippet. Left as-is; superseded by the JS below — see [Changes from `index.md`](#changes-from-indexmd). |
| `mindset-salesforce-handoff.js` | The integration. Drop into the host app. |
| `demo.html` | Runnable reference page wiring both widgets together. |
| `SALESFORCE-SETUP.md` | Declarative Salesforce work that must exist first. |

---

## How it works

```
Page load
  └─ Salesforce Embedded Messaging boots with hideChatButtonOnLoad = true
     (ready to go, nothing on screen)
  └─ Mindset agent renders — the only chat the customer sees
  └─ On "mindset:agent-idle", escalate_to_live_agent is registered as a page tool

Agent decides the customer needs a human
  └─ Calls escalate_to_live_agent({ summary, reason })
     └─ setHiddenPrechatFields()  — identity from the app, summary from the agent
     └─ utilAPI.launchChat()      — Salesforce chat opens
     └─ Mindset widget hides
     └─ Routing data lands on the Messaging Session, Omni-Channel Flow routes it

Live conversation ends
  └─ Mindset widget returns, thread intact
```

**No backend relay.** Salesforce renders its own chat window, so there is nothing
to host beyond the Mindset auth endpoint you already need.

### Why a page tool, and not an escalation callback

Mindset SDK 3 exposes **page tools** — `agent.setPageTools()` — as the documented
way to let an agent act on the host page. You define the tool, the agent decides
when to call it, and your handler runs in the browser.

An earlier design doc for this project referenced an `onAgentEscalationRequired`
callback. That does not appear anywhere in the SDK 3 documentation and should be
treated as not existing. Page tools are the mechanism.

Two constraints from the docs worth respecting:

- `setPageTools()` must be called **after** the element fires
  `"mindset:agent-idle"`, not immediately after `mindset.init()`.
- Re-call it on every navigation so the tool set reflects current page state.

### Who supplies what

| Data | Source | Why |
|---|---|---|
| First name, last name, email | **Host app session** | An LLM asked for a customer's email will invent a plausible one. Identity comes from your session object, never from tool arguments. |
| Issue summary, escalation reason | **The agent** | The agent is the only thing that has read the conversation. This is the routing signal. |
| Conversation ID | Generated at handoff | See [Open questions](#open-questions). |

---

## Setup

### 1. Salesforce

See `SALESFORCE-SETUP.md`. The short version: two new Custom Parameters
(`Mindset_Summary`, `Escalation_Reason`) plus matching Messaging Session fields
must be created, or the AI context arrives empty and you have gained nothing over
a plain chat button.

### 2. Mindset

Fill in the placeholders in `demo.html`:

| Placeholder | Where it comes from |
|---|---|
| `MINDSET-SERVER-URL` | Mindset CS (environment URL) |
| `YOUR-APP-UID` | Mindset CS |
| `YOUR-AGENT-UID` | AMS → Manage → Agents. **Case-sensitive — copy/paste, never retype.** |
| `/api/mindset/token` | Your backend endpoint |

The token endpoint is server-side only. It calls
`POST https://MINDSET-API-HOST/api/v1/appuid/{APP-UID}/sdkusers/auth` with the
`x-api-key` header. **The Mindset API key must never reach the browser.**

### 3. Configure the agent to escalate

The tool description tells the agent *how* to escalate. The agent's **Policy**
tells it *when*. Add something like:

> When you cannot resolve a customer's issue, when they ask to speak to a person,
> or when they express significant frustration, use the escalate_to_live_agent
> tool. Always write a full summary when you do.

One thing not to do: `"Escalate complex issues to a human agent"` as a bare
policy line with no tool behind it. An LLM cannot perform an action it has no
tool for — it will say it is transferring the customer and nothing will happen.
The policy only works because the page tool exists.

---

## Changes from `index.md`

`index.md` is left untouched. Three differences in the JS, all deliberate:

1. **`hideChatButtonOnLoad = true`.** Without it the Salesforce chat bubble sits
   on the page next to the Mindset widget from the moment it loads, and the
   customer picks whichever they like. The handoff stops being a handoff.

2. **Hidden pre-chat fields are set at escalation time, not in
   `onEmbeddedMessagingReady`.** `index.md` sets them inside the ready handler,
   which fires seconds after page load — long before the customer has said
   anything. At that point there is no summary to send. Setting them immediately
   before `launchChat()` is what makes carrying real AI context possible.

3. **Two extra fields** — `Mindset_Summary` and `Escalation_Reason`.

---

## Verify these before trusting them

`developer.salesforce.com` was returning HTTP 503 site-wide while this was
written, so parts of the Salesforce JS API could not be checked against source.
Marked honestly rather than presented as settled:

| Call | Status |
|---|---|
| `prechatAPI.setHiddenPrechatFields()` | **Confirmed** — already in use in `index.md` |
| `onEmbeddedMessagingReady` | **Confirmed** — already in use in `index.md` |
| `settings.hideChatButtonOnLoad` | **Unverified** |
| `utilAPI.launchChat()` | **Unverified** |
| `onEmbeddedMessagingConversationEnded` / `...Closed` | **Unverified** — name is a guess |

The conversation-end event only controls whether the Mindset widget comes back
after live chat, so a wrong name degrades gracefully rather than breaking the
handoff.

**To settle all of it in about two minutes:** load `demo.html` in the sandbox with
`CONFIG.debug = true` (the default), escalate once, and end the chat. Every
Salesforce lifecycle event that actually fires is logged to the console with its
real name. Prune `CONVERSATION_END_EVENTS` to whatever you see, and drop the
`DEBUG_WATCH_EVENTS` list once you have the answer.

---

## Open questions

- **Conversation correlation.** `External_Conversation_Id` is currently a UUID
  generated in the browser at handoff. It correlates a Salesforce Messaging
  Session to *an* escalation, but nothing on the Mindset side knows that UUID, so
  you cannot yet join a Salesforce session back to its Mindset thread. If the
  SDK exposes a thread or session identifier, use that instead — worth asking
  Mindset CS.

- **No agent available / off-hours.** Not handled. A queue with nobody on it does
  not fail, it waits indefinitely. Case creation as a fallback belongs in the
  Omni-Channel Flow, not in this JavaScript — sketched at the end of
  `SALESFORCE-SETUP.md`.

- **Return path.** When live chat ends, the Mindset agent comes back with its
  thread intact but no knowledge of what the representative said. Whether it
  should be told is a product decision, not a technical blocker.
