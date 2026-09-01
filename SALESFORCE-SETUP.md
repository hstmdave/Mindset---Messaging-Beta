# Salesforce setup for the Mindset handoff

Admin/declarative work that has to exist before the JavaScript in this repo does
anything useful. Nothing in `mindset-salesforce-handoff.js` substitutes for any
of it.

Target org: **`healthstream--hstm`** sandbox (`00DWL00000C6ZOy`)
Deployment: **`Mindset_Messaging_Beta`**

---

## 1. Deployment type — keep it as it is

The existing deployment is a standard **Messaging for In-App and Web** embedded
deployment using the JS bootstrap widget. That is the right type for this
approach and should not change.

> Worth stating plainly, because an earlier design doc for this project assumed
> otherwise: **Custom Client is not needed here.** Custom Client exists so you
> can drive the conversation entirely through the `iamessage/api/v2/*` REST
> endpoints and render every message in your own UI. That means building and
> hosting a message-relay backend. This repo takes the other path — Salesforce
> renders its own chat window — so the standard deployment is correct and there
> is no backend to build. Switching to Custom Client would break the snippet in
> `index.md`.

---

## 1b. Allowlist the origins — do this first

**Confirmed blocker, not a theoretical one.** Loading the widget from an origin
the org does not recognise fails like this:

```
Access to XMLHttpRequest at '.../embeddedservice/v1/embedded-service-config?...'
from origin 'http://localhost:8765' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
→ Uncaught (in promise) Error: Unable to load Embedded Messaging configuration.
```

The bootstrap script downloads fine and `init()` runs; the widget then cannot
fetch its own configuration and never becomes ready. Everything downstream —
`launchChat()`, hidden pre-chat fields, the whole handoff — is untestable until
this is fixed.

Origins that need adding:

| Origin | For |
|---|---|
| `http://localhost:8765` | Local development and `test-salesforce-only.html` |
| `https://hstmdave.github.io` | If this repo is published via GitHub Pages |
| The real HealthStream app origin | Production / staging |

Add all of them at once — otherwise this gets rediscovered twice more.

The exact Setup location could not be confirmed from the docs (Salesforce's
developer site was returning 503), so treat this as approximate: the origin
generally needs to be in **Setup → CORS → Allowed Origins List**, and the
Embedded Service Deployment has its own allowed-domains configuration as well.
Whichever this org enforces, both are quick.

---

## 2. Custom fields on Messaging Session

**Setup → Object Manager → Messaging Session → Fields & Relationships**

Dave confirmed these five Channel Variable names on `Mindset_Messaging_Beta`
(they appear in his bootstrap snippet and in `index.md`):

| Field | Type | Purpose |
|---|---|---|
| `External_Conversation_Id__c` | Text(255) | Correlates the Salesforce session back to the Mindset conversation |
| `First_Name__c` | Text(255) | Customer identity from the host app |
| `Last_Name__c` | Text(255) | Customer identity from the host app |
| `User_Email__c` | Email | Customer identity from the host app |
| `PreChat_URL__c` | URL | Which page the customer escalated from |

**These two are not in Dave's snippet and are not registered yet.** He noted
CustEx will want more mappings later. Until they exist as Custom Parameters,
the JS sends `null` for them so Salesforce does not silently drop unknown names.
They are the reason a handoff is more useful than a plain chat button — without
them the representative gets a name and no idea what the customer already tried:

| Field | Type | Purpose |
|---|---|---|
| `Mindset_Summary__c` | Long Text Area (2000) | The AI-written summary of the issue. **This is the routing signal.** |
| `Escalation_Reason__c` | Picklist or Text(80) | `customer_requested`, `unresolved`, `out_of_scope`, `complaint`, `urgent` |

Long Text Area for the summary, not Text(255) — summaries run long and a Text
field truncates silently.

---

## 3. Register the Custom Parameters

**Setup → Messaging Settings → `Mindset_Messaging_Beta` → Custom Parameters → New**

One entry per field. The **Channel Variable Name** must match the string in
`CONFIG.prechatFields` in `mindset-salesforce-handoff.js` **exactly, including
case**:

```
External_Conversation_Id
PreChat_URL
First_Name
Last_Name
User_Email
Mindset_Summary        <- new
Escalation_Reason      <- new
```

This is the highest-traffic failure in the whole integration. A name that does
not match a registered parameter is **discarded silently** — no console error, no
API error, the Flow variable simply arrives empty and routing falls through to
the default queue. If a field shows up blank on the Messaging Session, check
casing here first.

If you would rather not create the two new parameters yet, set
`summary: null` and `reason: null` in `CONFIG.prechatFields` so the code stops
sending names Salesforce will throw away.

---

## 4. Omni-Channel Flow

**Setup → Flows → your Messaging Session routing flow**

1. **Input variables** — one per parameter, marked *Available for input*:
   `Input_External_Conversation_Id`, `Input_First_Name`, `Input_Last_Name`,
   `Input_User_Email`, `Input_Mindset_Summary`, `Input_Escalation_Reason`.
2. **Parameter Mappings** — map each Custom Parameter to its Flow variable.
3. **Update Records** — first element in the flow: stamp all of those onto the
   MessagingSession record so the representative can see them in the console.
4. **Decision** — branch on the data. This is where the AI summary earns its
   keep: route on `Input_Escalation_Reason` for urgency, or on keywords in
   `Input_Mindset_Summary` for product area.
5. **Route Work** — queue or skill-based, with a fallback queue for overflow.

---

## 5. Agent console layout

**Setup → Lightning App Builder → Messaging Session record page**

Put `Mindset_Summary__c` somewhere the representative sees it *without
scrolling*. The whole value of the handoff is that the human opens the chat
already knowing the story; a summary buried in a Details tab does not get read
during a live conversation.

---

## Not covered here: no agent available / off-hours

If nobody is on the queue, or support is closed, the chat sits in the queue
indefinitely — a queue with zero available representatives does not fail, it just
waits. Handling that means creating a Case instead, and it belongs in the Flow,
not in this JavaScript: only Salesforce knows real-time agent presence and
business hours.

Sketch of the standard pattern, for when you get to it:

- **Off-hours** (predictable): a `BusinessHours.isWithin()` invocable Apex action,
  called from a Decision element *before* Route Work.
- **No agent available** (only detectable after routing): a Wait element after
  Route Work, resuming on `Status = In Progress` or a fixed timeout, whichever
  comes first; the timeout path branches to case creation.
- Both paths converge on Create Records (Case, `Origin = 'Chat'`, populated from
  the same stamped variables) then Send Conversation Messages to give the
  customer the case number.

That work is out of scope for this repo and is tracked separately.
