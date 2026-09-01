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
| `index.html` | Live GitHub Pages demo. The chat is the page; diagnostics hide behind the Ready chip. |
| `index.md` | The original Salesforce Embedded Messaging snippet, plus the first Pages draft. Not the live page anymore — see [Changes from `index.md`](#changes-from-indexmd). |
| `mindset-salesforce-handoff.js` | The integration. Drop into the host app. |
| `demo.html` | Reference page wiring both widgets together. Needs the Mindset placeholders filled in before it will run. |
| `test-salesforce-only.html` | Standalone Salesforce-side test harness. No Mindset dependency — runs today. |
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

## Running it on GitHub Pages

The live page is <https://hstmdave.github.io/Mindset---Messaging-Beta/>, served
from `index.html` (`.nojekyll` so GitHub Pages does not wrap it in a theme).
It loads the Mindset SDK, the handoff module, and a status chip that expands
into the diagnostic checklist only when something is missing.

The Mindset values are filled in:

| Value | Setting |
|---|---|
| SDK | `https://mindset-prod4-usw-embedded-sdk-v3.web.app/mindset-sdk3.umd.js` |
| `appUid` | `healthstream` |
| `agentUid` | `HCwuUNFTkBSYIo0WvUlG` |
| `enableVoice` | `true` |

The agent is embedded inline at 600px rather than as a floating corner widget,
and is hidden (height collapsed) while the Salesforce chat is open.

One note on `enableVoice`: the docs type it as a boolean defaulting to `false`,
so it is set here as `true` rather than the string `'true'`. Either works — a
non-empty string is truthy — but the boolean is what the SDK expects. Voice is
also unsupported in Firefox, and in an iframe needs `allow="microphone"` or it
fails in Safari.

### Anonymous access is mandatory here

GitHub Pages is static hosting. It cannot hold a Mindset API key and cannot host
the `/api/mindset/token` endpoint, so `fetchAuthentication` is not an option on
this page — it uses anonymous access instead. Two things must be true in AMS or
the agent will not load:

1. **Anonymous access enabled on the agent.** Without it: `SDK_ERR_1005`. This is
   the opposite of the recommended production default, and is a property of this
   demo page, not a recommendation for the product build.
2. **The page's origin in the safelist, written as a full absolute URL.**
   Without it: `SDK_ERR_1006`.

### The safelist entry must include the scheme

`https://hstmdave.github.io` works. `hstmdave.github.io` does not.

This is worth stating flatly because the failure is silent and the error message
("URL not in anonymous access safelist/whitelist") suggests the entry is missing
rather than malformed. Read out of the SDK bundle, the comparison is:

```js
static compareUrls(entry, pageUrl) {
  try {
    const a = new URL(entry), b = new URL(pageUrl);
    if (a.protocol !== b.protocol) return false;
    return a.hostname === b.hostname;
  } catch { return false; }   // <-- a bare domain lands here
}
```

Both sides go through `new URL()`. `new URL("hstmdave.github.io")` throws, the
throw is swallowed by the `catch`, and the entry simply never matches anything.

What follows from that:

| Entry | Result |
|---|---|
| `https://hstmdave.github.io` | matches |
| `https://hstmdave.github.io/Mindset---Messaging-Beta/` | matches — path is ignored |
| `hstmdave.github.io` | never matches — `new URL()` throws |
| `http://hstmdave.github.io` | never matches — protocol must be identical |
| `https://*.github.io` | never matches — no wildcard support |

Only protocol and hostname are compared, so one entry per origin covers every
page on that origin. Subdomains need their own entries.

**Diagnosing which of the two is wrong:** the error code distinguishes them.
`SDK_ERR_1005` means the agent does not allow anonymous access at all;
`SDK_ERR_1006` means it does, and the URL is what failed. Getting 1006 is
therefore mildly good news — it means step 1 is already done.

The real embedded build should create an agent session server-side and pass the
`agentSessionUid` — noting that the SDK takes it in the `agentUid` attribute,
not a separate one.

### Identity is self-reported on this page

With no session, there is no authoritative source for the customer's name and
email, so `allowAgentSuppliedIdentity` is switched on and the agent asks for them
in conversation. Those values reach Salesforce unverified.

That is a deliberate downgrade for a beta test page, not a change of principle.
In the embedded build, identity comes from the host app's session and the agent
supplies only the summary — see [Who supplies what](#who-supplies-what).

## Setup

### 1. Salesforce

See `SALESFORCE-SETUP.md`. Dave's live Channel Variables are
`External_Conversation_Id`, `PreChat_URL`, `First_Name`, `Last_Name`, and
`User_Email`. Further fields (summary, reason, whatever CustEx wants mapped)
wait on Setup — unregistered names are dropped silently.

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

3. **Only Dave's five Channel Variables are sent today** —
   `External_Conversation_Id`, `PreChat_URL`, `First_Name`, `Last_Name`,
   `User_Email`. `Mindset_Summary` / `Escalation_Reason` stay `null` until
   CustEx registers them.

---

## Verify these before trusting them

`developer.salesforce.com` was returning HTTP 503 site-wide while this was
written, so parts of the Salesforce JS API could not be checked against source.
Marked honestly rather than presented as settled:

| Call | Status |
|---|---|
| `prechatAPI.setHiddenPrechatFields()` | **Confirmed** — already in use in `index.md` |
| `onEmbeddedMessagingReady` | **Confirmed** — already in use in `index.md` |
| `siteUrl + /assets/js/bootstrap.min.js` | **Confirmed** — loads from the sandbox |
| `settings.hideChatButtonOnLoad` | **Partly confirmed** — accepted as a settable property, reads back `true`. Whether it actually suppresses the launcher is still unproven (see CORS below). |
| `boot.init(orgId, esDeveloperName, siteUrl, {scrt2URL})` | **Confirmed** — accepted without throwing |
| `utilAPI.launchChat()` | **Unverified** — blocked by CORS |
| `onEmbeddedMessagingConversationEnded` / `...Closed` | **Unverified** — name is a guess, blocked by CORS |

The conversation-end event only controls whether the Mindset widget comes back
after live chat, so a wrong name degrades gracefully rather than breaking the
handoff.

### Use `test-salesforce-only.html` to settle the rest

`test-salesforce-only.html` is a standalone harness with **no Mindset dependency**
— it needs nothing but a static file server, so it can be run long before the
Mindset credentials exist. It listens for all eleven candidate lifecycle event
names and logs, on-page, whichever ones actually fire. Serve the repo folder and
open it:

```
python -m http.server 8765
# then http://localhost:8765/test-salesforce-only.html
```

### Blocker: the origin must be allowlisted in Salesforce

Running the harness from `http://localhost:8765` produces:

```
Access to XMLHttpRequest at 'https://healthstream--hstm.sandbox.my.salesforce-scrt.com/
embeddedservice/v1/embedded-service-config?orgId=00DWL00000C6ZOy&...'
from origin 'http://localhost:8765' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
→ Uncaught (in promise) Error: Unable to load Embedded Messaging configuration.
```

The bootstrap script itself downloads fine and `init()` runs — the widget then
fails fetching its own configuration, because the org does not recognise the
origin. Nothing downstream of that point can be tested until an admin adds it.

**`hstmdave.github.io` is already allowlisted** — the live Pages site boots
Salesforce successfully (`embeddedservice_bootstrap.utilAPI` is present on
`https://hstmdave.github.io/Mindset---Messaging-Beta/`). So this is a
localhost-only problem, not a general one.

That means you can either add `http://localhost:8765` to the allowlist for local
development, or skip local entirely and test on the Pages site, which already
works. The origin the real HealthStream app is served from will need adding when
you get there.

The exact Setup path could not be confirmed (`developer.salesforce.com` was
returning 503 site-wide), so treat the naming as approximate — but the origin
generally needs to be present in **Setup → CORS → Allowed Origins List**, and in
the Embedded Service Deployment's own allowed-domains configuration. Dave will
know which of the two this org actually enforces.

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
