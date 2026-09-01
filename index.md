# Mindset → Salesforce Messaging Beta

**The live GitHub Pages demo is [`index.html`](./index.html)** —
<https://hstmdave.github.io/Mindset---Messaging-Beta/>.

This markdown file is the earlier Pages draft (and, in git history, Dave's
original Embedded Messaging snippet). Keep it for reference; do not treat it
as the running page.

---

Live test page. The Mindset agent is the only chat visible; when it decides the
customer needs a human, it opens the Salesforce live chat and steps aside.

Salesforce initialisation now lives in `mindset-salesforce-handoff.js` rather
than inline on this page, so the launcher can be suppressed on load and the
hidden pre-chat fields can be stamped at escalation time — when there is actually
a summary to send. The previous inline snippet is preserved in git history.

<div id="status-panel">Checking…</div>

<div id="mindset-wrapper">
  <mindset-agent
    agentUid="HCwuUNFTkBSYIo0WvUlG"
    style="width: 100%; height: 600px; display: block; background-color: rgb(255, 255, 255);">
  </mindset-agent>
</div>

<p>
  <button type="button" id="manual-escalate" disabled>
    Trigger handoff manually (bypasses the agent)
  </button>
</p>

<style>
#status-panel {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 0.82rem;
  line-height: 1.7;
  background: #f3f6f9;
  border-left: 3px solid #939393;
  padding: 0.75rem 1rem;
  margin: 1.5rem 0;
  white-space: pre-wrap;
}
#status-panel[data-state="ok"]   { border-left-color: #2e844a; background: #ebf7ee; }
#status-panel[data-state="warn"] { border-left-color: #dd7a01; background: #fef5e7; }

/* Inline embed, matching the 600px block sizing supplied with the agent
   snippet — the agent sits in the page flow rather than floating in a corner. */
#mindset-wrapper {
  margin: 1.5rem 0;
  border: 1px solid #e5e5e5;
  border-radius: 6px;
  overflow: hidden;
  transition: opacity 0.2s ease;
}

/* Set by mindset-salesforce-handoff.js while the Salesforce chat is open, and
   removed when the live conversation ends. visibility rather than display:none
   so the agent keeps its thread and the customer comes back to it intact. */
#mindset-wrapper[data-handoff-hidden] {
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
  height: 0;
  margin: 0;
  border-width: 0;
}
</style>

<!-- Mindset SDK 3 — prod4 US-West environment -->
<script src="https://mindset-prod4-usw-embedded-sdk-v3.web.app/mindset-sdk3.umd.js"></script>

<script src="./mindset-salesforce-handoff.js"></script>

<script>
(function () {
  // -------------------------------------------------------------------------
  // Salesforce first, and in its own statement.
  //
  // If the Mindset SDK is not configured yet its script 404s, `mindset` is
  // undefined, and anything referencing it throws. Booting Salesforce before we
  // touch Mindset — and guarding the Mindset call — keeps the working half of
  // this page working while the other half is still being wired up.
  // -------------------------------------------------------------------------
  MindsetSalesforceHandoff.init({
    config: {
      // This page is anonymous: GitHub Pages is static hosting, so there is no
      // session and no backend to read a signed-in user from. The agent asks the
      // customer for their name and email instead, and passes them as tool
      // arguments. That identity is self-reported and unverified — fine for a
      // beta test page, not how the embedded product build should work.
      allowAgentSuppliedIdentity: true
    }
  });

  var mindsetLoaded = (typeof window.mindset !== 'undefined');

  if (mindsetLoaded) {
    window.mindset.init({
      appUid: 'healthstream',

      // Boolean, not the string 'true' — the docs type this as a boolean
      // defaulting to false. A non-empty string is truthy so either happens to
      // work, but the boolean is what the SDK expects.
      enableVoice: true

      // No fetchAuthentication — this page uses anonymous access, because a
      // static site cannot hold a Mindset API key or host a token endpoint.
      //
      // Anonymous access requires, in AMS:
      //   1. the agent flagged to allow anonymous access
      //      (otherwise: SDK_ERR_1005)
      //   2. this page's origin in the safelist, written as a full absolute URL
      //      WITH the scheme: https://hstmdave.github.io
      //      A bare domain does not work. The SDK runs both the safelist entry
      //      and the page URL through new URL(); a bare domain throws, the
      //      throw is swallowed, and the entry silently never matches.
      //      (otherwise: SDK_ERR_1006)
      //
      // The real embedded build should do the opposite: create an agent session
      // server-side and pass the agentSessionUid. Note the SDK takes that in the
      // agentUid attribute — there is no separate attribute for it.
    });
  }

  // -------------------------------------------------------------------------
  // Self-diagnosis, so the page says what is missing instead of looking broken
  // -------------------------------------------------------------------------
  var panel = document.getElementById('status-panel');
  var btn = document.getElementById('manual-escalate');

  function tick(ok) { return ok ? '✓' : '✗'; }

  // The agent renders its failures inside its own shadow DOM, so "the custom
  // element upgraded" and "the agent actually loaded" are different questions.
  // Reporting only the first is how this panel managed to show four ticks while
  // the page displayed an error card.
  function agentError(root, depth) {
    if (!root || depth > 6) return null;
    var text = root.textContent || '';
    var m = text.match(/SDK_ERR_\d+/);
    if (m) return m[0];

    var kids = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].shadowRoot) {
        var found = agentError(kids[i].shadowRoot, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  var ERRORS = {
    SDK_ERR_1005: 'Anonymous access is not enabled on the agent itself.',
    SDK_ERR_1006: 'This page URL is not in the anonymous access safelist.'
  };

  function refresh() {
    var agentEl = document.querySelector('mindset-agent');
    var sdk = (typeof window.mindset !== 'undefined');
    var upgraded = !!(agentEl && typeof agentEl.setPageTools === 'function');
    var boot = window.embeddedservice_bootstrap;
    var sfReady = !!(boot && boot.utilAPI);
    var configured = (agentEl && agentEl.getAttribute('agentUid') !== 'YOUR-AGENT-UID');

    var err = agentEl ? (agentError(agentEl, 0) ||
                         (agentEl.shadowRoot ? agentError(agentEl.shadowRoot, 0) : null)) : null;
    var loaded = upgraded && !err;

    var lines = [
      tick(sdk) + ' Mindset SDK script loaded',
      tick(configured) + ' Mindset appUid / agentUid filled in',
      tick(upgraded) + ' <mindset-agent> upgraded by the SDK',
      tick(loaded) + ' Agent loaded without error',
      tick(sfReady) + ' Salesforce Embedded Messaging ready'
    ];

    if (!sdk) {
      lines.push('');
      lines.push('The SDK script did not load from');
      lines.push('mindset-prod4-usw-embedded-sdk-v3.web.app — check the network tab.');
    } else if (err) {
      lines.push('');
      lines.push(err + ' — ' + (ERRORS[err] || 'See the agent panel below.'));
      if (err === 'SDK_ERR_1006') {
        lines.push('');
        lines.push('The safelist entry must be a full absolute URL including the');
        lines.push('scheme. A bare domain never matches, because the SDK parses');
        lines.push('both sides with new URL() and a bare domain throws.');
        lines.push('');
        lines.push('  this page needs:  ' + window.location.origin);
      }
    }

    panel.textContent = lines.join('\n');
    panel.setAttribute('data-state', (sdk && loaded && sfReady) ? 'ok' : 'warn');

    if (sfReady) btn.disabled = false;
  }

  refresh();
  window.addEventListener('onEmbeddedMessagingReady', refresh);
  setTimeout(refresh, 2000);
  setTimeout(refresh, 6000);

  btn.addEventListener('click', function () {
    MindsetSalesforceHandoff.handoff({
      summary: 'Manual test escalation from the beta page. No agent involved.',
      reason: 'customer_requested',
      firstName: 'Test',
      lastName: 'Handoff',
      email: 'test.handoff@example.com'
    });
  });
})();
</script>
