# Mindset → Salesforce Messaging Beta

Live test page. The Mindset agent is the only chat visible; when it decides the
customer needs a human, it opens the Salesforce live chat and steps aside.

Salesforce initialisation now lives in `mindset-salesforce-handoff.js` rather
than inline on this page, so the launcher can be suppressed on load and the
hidden pre-chat fields can be stamped at escalation time — when there is actually
a summary to send. The previous inline snippet is preserved in git history.

<div id="status-panel">Checking…</div>

<div id="mindset-wrapper">
  <mindset-agent agentUid="YOUR-AGENT-UID"></mindset-agent>
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

#mindset-wrapper {
  position: fixed;
  bottom: 1rem;
  right: 1rem;
  width: 24rem;
  max-width: calc(100vw - 2rem);
  height: 32rem;
  max-height: calc(100vh - 2rem);
  z-index: 100;
  transition: opacity 0.2s ease;
}

/* Set by mindset-salesforce-handoff.js while the Salesforce chat is open, and
   removed when the live conversation ends. visibility rather than display:none
   so the agent keeps its thread and the customer comes back to it intact. */
#mindset-wrapper[data-handoff-hidden] {
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
}

mindset-agent { width: 100%; height: 100%; }
</style>

<!-- ==========================================================================
     Mindset SDK 3

     Replace MINDSET-SERVER-URL with the environment URL from Mindset CS, and
     YOUR-AGENT-UID above / YOUR-APP-UID below with the values from AMS.
     UIDs are case-sensitive — copy and paste them, never retype.
     ========================================================================== -->
<script src="MINDSET-SERVER-URL/mindset-sdk3.umd.js"></script>

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
      appUid: 'YOUR-APP-UID'

      // No fetchAuthentication — this page uses anonymous access, because a
      // static site cannot hold a Mindset API key or host a token endpoint.
      //
      // Anonymous access requires, in AMS:
      //   1. hstmdave.github.io safelisted for anonymous access
      //      (otherwise: SDK_ERR_1006)
      //   2. the agent set to Open access — a Restricted agent with no accounts
      //      is only reachable through an agent session, and there is no
      //      backend here to create one
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

  function refresh() {
    var agentEl = document.querySelector('mindset-agent');
    var sdk = (typeof window.mindset !== 'undefined');
    var upgraded = !!(agentEl && typeof agentEl.setPageTools === 'function');
    var boot = window.embeddedservice_bootstrap;
    var sfReady = !!(boot && boot.utilAPI);
    var configured = (agentEl && agentEl.getAttribute('agentUid') !== 'YOUR-AGENT-UID');

    var lines = [
      tick(sdk) + ' Mindset SDK script loaded',
      tick(configured) + ' Mindset appUid / agentUid filled in',
      tick(upgraded) + ' <mindset-agent> upgraded by the SDK',
      tick(sfReady) + ' Salesforce Embedded Messaging ready'
    ];

    if (!sdk) {
      lines.push('');
      lines.push('The Mindset SDK did not load. Replace MINDSET-SERVER-URL in');
      lines.push('index.md with the environment URL from Mindset CS.');
    } else if (!configured) {
      lines.push('');
      lines.push('SDK loaded but still on placeholder UIDs. Fill in YOUR-APP-UID');
      lines.push('and YOUR-AGENT-UID from AMS.');
    }

    panel.textContent = lines.join('\n');
    panel.setAttribute('data-state', (sdk && upgraded && sfReady) ? 'ok' : 'warn');

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
