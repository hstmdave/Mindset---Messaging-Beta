/**
 * mindset-salesforce-handoff.js
 *
 * Hands a conversation off from a Mindset AI agent to a Salesforce live agent.
 *
 * Flow:
 *   1. Salesforce Embedded Messaging boots on page load with its launcher button
 *      HIDDEN, so the customer only ever sees the Mindset agent to begin with.
 *   2. The Mindset agent is given a page tool, `escalate_to_live_agent`. The agent
 *      calls it when it decides the customer needs a human, passing a summary.
 *   3. The handler stamps the hidden pre-chat fields (identity from the host app,
 *      summary from the agent), launches the Salesforce chat, and hides Mindset.
 *   4. When the Salesforce conversation ends, Mindset comes back.
 *
 * Identity (name, email) comes from the HOST APP, never from the agent. An LLM
 * can hallucinate an email address; your session object cannot. The agent only
 * supplies the things it is actually the authority on -- the summary and reason.
 *
 * Usage:
 *   <script src="mindset-salesforce-handoff.js"></script>
 *   MindsetSalesforceHandoff.init({
 *     user: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' }
 *   });
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  var CONFIG = {
    salesforce: {
      // These four values are lifted verbatim from index.md in this repo.
      orgId: '00DWL00000C6ZOy',
      esDeveloperName: 'Mindset_Messaging_Beta',
      siteUrl: 'https://healthstream--hstm.sandbox.my.site.com/ESWMindsetMessagingBeta1787680662848',
      scrt2URL: 'https://healthstream--hstm.sandbox.my.salesforce-scrt.com',
      language: 'en_US'
    },

    mindset: {
      // The <mindset-agent> element, and the wrapper we hide during handoff.
      // We hide a plain wrapper div rather than the custom element itself so we
      // never interfere with the SDK's shadow DOM.
      agentSelector: 'mindset-agent',
      wrapperSelector: '#mindset-wrapper'
    },

    // Hidden pre-chat field names. These are the CHANNEL VARIABLE NAMES from
    // Salesforce Setup, and they are CASE-SENSITIVE. A name that does not match
    // a registered Custom Parameter is dropped silently -- no error, the Flow
    // variable just arrives empty. See SALESFORCE-SETUP.md.
    //
    // Source of truth: Dave's Mindset_Messaging_Beta snippet (the five keys
    // below). Extra mappings wait on CustEx.
    prechatFields: {
      conversationId: 'External_Conversation_Id',
      pageUrl: 'PreChat_URL',
      firstName: 'First_Name',
      lastName: 'Last_Name',
      email: 'User_Email',

      // Not in the live deployment. Leave null so we do not send names
      // Salesforce will discard. Add them back when CustEx registers them.
      summary: null,
      reason: null
    },

    // When true, the escalation tool also accepts firstName / lastName / email
    // as tool arguments.
    //
    // Only turn this on where there is genuinely no signed-in user to read from
    // -- a static GitHub Pages demo, an anonymous-access agent. Identity that
    // comes from an LLM is self-reported: the agent is repeating what the
    // customer typed, and nothing has verified it. Anything supplied by the host
    // app always wins over the agent's version.
    allowAgentSuppliedIdentity: false,

    // Logs every Salesforce lifecycle event that actually fires. Leave this on
    // in the sandbox -- it is how you confirm the event names below are right.
    debug: true
  };

  // Salesforce lifecycle events. `onEmbeddedMessagingReady` is confirmed -- it is
  // already used in index.md. The rest are best-guess names that could NOT be
  // verified (developer.salesforce.com was returning 503 when this was written).
  //
  // Run with debug:true in the sandbox, escalate once, end the chat, and read the
  // console. Whatever logs is real; delete the rest from these arrays.
  var READY_EVENT = 'onEmbeddedMessagingReady';

  var CONVERSATION_END_EVENTS = [
    'onEmbeddedMessagingConversationEnded',
    'onEmbeddedMessagingConversationClosed'
  ];

  var DEBUG_WATCH_EVENTS = [
    'onEmbeddedMessagingReady',
    'onEmbeddedMessagingButtonCreated',
    'onEmbeddedMessagingButtonClicked',
    'onEmbeddedMessagingWindowMaximized',
    'onEmbeddedMessagingWindowMinimized',
    'onEmbeddedMessagingConversationOpened',
    'onEmbeddedMessagingConversationStarted',
    'onEmbeddedMessagingConversationEnded',
    'onEmbeddedMessagingConversationClosed',
    'onEmbeddedMessagingInviteAccepted',
    'onEmbeddedMessagingInviteRejected'
  ];

  // ---------------------------------------------------------------------------
  // Internal state
  // ---------------------------------------------------------------------------

  var state = {
    user: null,          // { firstName, lastName, email } from the host app
    getUser: null,       // optional () => user, for apps that resolve it late
    salesforceReady: null,
    handoffActive: false,
    conversationId: null
  };

  function log() {
    if (!CONFIG.debug) return;
    var args = Array.prototype.slice.call(arguments);
    console.log.apply(console, ['[mindset-sf-handoff]'].concat(args));
  }

  function warn() {
    var args = Array.prototype.slice.call(arguments);
    console.warn.apply(console, ['[mindset-sf-handoff]'].concat(args));
  }

  function newConversationId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    // Fallback for older browsers / non-secure contexts.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function resolveUser() {
    if (typeof state.getUser === 'function') return state.getUser();
    return state.user;
  }

  // ---------------------------------------------------------------------------
  // Salesforce: boot silently
  // ---------------------------------------------------------------------------

  /**
   * Injects the Embedded Messaging bootstrap and resolves once Salesforce is
   * ready. The launcher button is suppressed so nothing appears on screen until
   * we explicitly launch it.
   */
  function bootSalesforce() {
    if (state.salesforceReady) return state.salesforceReady;

    state.salesforceReady = new Promise(function (resolve, reject) {
      // Listener must be attached BEFORE the bootstrap runs, or the ready event
      // can fire before we are listening for it.
      global.addEventListener(READY_EVENT, function onReady() {
        log('Salesforce Embedded Messaging ready');
        resolve();
      }, { once: true });

      if (CONFIG.debug) attachDebugListeners();

      var script = document.createElement('script');
      script.type = 'text/javascript';
      script.src = CONFIG.salesforce.siteUrl + '/assets/js/bootstrap.min.js';

      script.onload = function () {
        try {
          var boot = global.embeddedservice_bootstrap;
          boot.settings.language = CONFIG.salesforce.language;

          // The one setting that makes this a "second window on demand" rather
          // than a permanent chat bubble competing with the Mindset widget.
          boot.settings.hideChatButtonOnLoad = true;

          boot.init(
            CONFIG.salesforce.orgId,
            CONFIG.salesforce.esDeveloperName,
            CONFIG.salesforce.siteUrl,
            { scrt2URL: CONFIG.salesforce.scrt2URL }
          );
        } catch (err) {
          console.error('[mindset-sf-handoff] Error loading Embedded Messaging:', err);
          reject(err);
        }
      };

      script.onerror = function () {
        reject(new Error('Failed to load Salesforce bootstrap.min.js'));
      };

      document.head.appendChild(script);
    });

    return state.salesforceReady;
  }

  function attachDebugListeners() {
    DEBUG_WATCH_EVENTS.forEach(function (name) {
      global.addEventListener(name, function (e) {
        log('SF event fired:', name, e && e.detail ? e.detail : '');
      });
    });
    log('Debug listeners attached. Event names that log here are the real ones.');
  }

  // ---------------------------------------------------------------------------
  // The handoff itself
  // ---------------------------------------------------------------------------

  function buildPrechatFields(args) {
    var user = resolveUser() || {};

    // On an anonymous page there is no session to read identity from, so the
    // agent may have collected it in conversation. Fill gaps only -- never let
    // the agent's version override a real signed-in user.
    if (CONFIG.allowAgentSuppliedIdentity) {
      user = {
        firstName: user.firstName || args.firstName,
        lastName: user.lastName || args.lastName,
        email: user.email || args.email
      };
    }

    var names = CONFIG.prechatFields;
    var fields = {};

    function put(fieldName, value) {
      // Skip unregistered (null) field names and empty values -- sending either
      // just adds noise to a payload Salesforce will not act on.
      if (!fieldName) return;
      if (value === undefined || value === null || value === '') return;
      fields[fieldName] = String(value);
    }

    put(names.conversationId, state.conversationId);
    put(names.pageUrl, global.location.origin);
    put(names.firstName, user.firstName);
    put(names.lastName, user.lastName);
    put(names.email, user.email);

    // From the agent.
    put(names.summary, args.summary);
    put(names.reason, args.reason);

    return fields;
  }

  /**
   * Escalate: stamp routing data, open the Salesforce chat, hide Mindset.
   * Returns a plain object suitable for handing straight back to the agent.
   */
  function handoff(args) {
    args = args || {};

    if (state.handoffActive) {
      return Promise.resolve({
        status: 'already_connected',
        message: 'A live agent chat is already open for this customer.'
      });
    }

    state.conversationId = newConversationId();

    return bootSalesforce()
      .then(function () {
        var boot = global.embeddedservice_bootstrap;
        var fields = buildPrechatFields(args);

        // Hidden pre-chat fields must be set BEFORE the conversation starts.
        // Note this differs from index.md, which sets them inside the ready
        // handler -- at that point the Mindset summary does not exist yet, so
        // the fields would go out empty. Setting them here, immediately before
        // launch, is what lets us carry real AI context into routing.
        boot.prechatAPI.setHiddenPrechatFields(fields);
        log('Hidden pre-chat fields set:', fields);

        return boot.utilAPI.launchChat();
      })
      .then(function () {
        state.handoffActive = true;
        hideMindset();
        listenForConversationEnd();

        log('Live agent chat launched. conversationId =', state.conversationId);

        return {
          status: 'connected',
          conversationId: state.conversationId,
          message: 'A live support chat is now open. The customer has been ' +
                   'connected to the Salesforce queue and can continue there.'
        };
      })
      .catch(function (err) {
        console.error('[mindset-sf-handoff] Handoff failed:', err);
        state.handoffActive = false;
        showMindset();

        return {
          status: 'error',
          message: 'Could not open the live agent chat. Tell the customer to ' +
                   'try again shortly, or offer to raise a support case instead.',
          error: String(err && err.message ? err.message : err)
        };
      });
  }

  var endListenersAttached = false;

  function listenForConversationEnd() {
    if (endListenersAttached) return;
    endListenersAttached = true;

    CONVERSATION_END_EVENTS.forEach(function (name) {
      global.addEventListener(name, function () {
        if (!state.handoffActive) return;
        log('Conversation ended via', name, '-- restoring Mindset');
        state.handoffActive = false;
        showMindset();
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Showing / hiding the Mindset widget
  // ---------------------------------------------------------------------------

  function mindsetWrapper() {
    return document.querySelector(CONFIG.mindset.wrapperSelector);
  }

  function hideMindset() {
    var el = mindsetWrapper();
    if (!el) {
      warn('No element matched', CONFIG.mindset.wrapperSelector,
           '-- Mindset will stay visible alongside the Salesforce chat.');
      return;
    }
    el.setAttribute('data-handoff-hidden', 'true');
  }

  function showMindset() {
    var el = mindsetWrapper();
    if (el) el.removeAttribute('data-handoff-hidden');
  }

  // ---------------------------------------------------------------------------
  // Mindset page tool registration
  // ---------------------------------------------------------------------------

  /**
   * Registers the escalation tool on a <mindset-agent> element.
   *
   * Per the Mindset SDK 3 docs, setPageTools() must be called only after the
   * element has emitted "mindset:agent-idle", and should be re-called on every
   * navigation so the tool set reflects current page state.
   */
  function registerPageTools(agentEl) {
    agentEl = agentEl || document.querySelector(CONFIG.mindset.agentSelector);

    if (!agentEl) {
      warn('No <mindset-agent> element found; page tool not registered.');
      return;
    }

    var toolProperties = {
      summary: {
        type: 'string',
        description:
          'A concise summary of the customer\'s issue and everything ' +
          'already tried, written for a human representative who has not ' +
          'seen this conversation. Include product area and any ' +
          'identifiers the customer gave you.'
      },
      reason: {
        type: 'string',
        description:
          'Why this is being escalated. One of: customer_requested, ' +
          'unresolved, out_of_scope, complaint, urgent.'
      }
    };

    var toolRequired = ['summary'];

    // Anonymous pages only -- see CONFIG.allowAgentSuppliedIdentity.
    if (CONFIG.allowAgentSuppliedIdentity) {
      toolProperties.firstName = {
        type: 'string',
        description: 'The customer\'s first name, as they gave it to you.'
      };
      toolProperties.lastName = {
        type: 'string',
        description: 'The customer\'s last name, as they gave it to you.'
      };
      toolProperties.email = {
        type: 'string',
        description:
          'The customer\'s email address, exactly as they typed it. Ask for ' +
          'it before escalating if you do not have it. Never guess or ' +
          'construct an address from their name.'
      };
      toolRequired = ['summary', 'email'];
    }

    agentEl.setPageTools([
      {
        name: 'escalate_to_live_agent',
        description:
          'Hand this conversation to a human support representative over live ' +
          'chat. Use this when the customer explicitly asks for a person, when ' +
          'you cannot resolve their issue, or when the situation needs human ' +
          'judgement. Always write a summary first -- the summary is what the ' +
          'support team uses to route the chat to the right representative, ' +
          'and it is the only context they receive.',
        runningDescription: 'Connecting you to a support representative...',
        completedDescription: 'Connected to support',
        parameters: {
          type: 'object',
          properties: toolProperties,
          required: toolRequired
        },
        handler: function (args) {
          return handoff(args);
        }
      }
    ]);

    log('Page tool "escalate_to_live_agent" registered.');
  }

  /**
   * Convenience: waits for mindset:agent-idle, then registers the tool.
   */
  function autoRegisterPageTools() {
    var agentEl = document.querySelector(CONFIG.mindset.agentSelector);
    if (!agentEl) {
      warn('No <mindset-agent> element found; skipping auto-registration.');
      return;
    }

    agentEl.addEventListener('mindset:agent-idle', function onIdle() {
      registerPageTools(agentEl);
    }, { once: true });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  function init(options) {
    options = options || {};

    state.user = options.user || null;
    state.getUser = options.getUser || null;

    if (options.config) {
      // Shallow per-section merge, enough for overriding org/field names.
      Object.keys(options.config).forEach(function (section) {
        if (typeof CONFIG[section] === 'object' && CONFIG[section] !== null) {
          Object.assign(CONFIG[section], options.config[section]);
        } else {
          CONFIG[section] = options.config[section];
        }
      });
    }

    if (!state.user && !state.getUser && !CONFIG.allowAgentSuppliedIdentity) {
      warn('No user supplied and allowAgentSuppliedIdentity is off. ' +
           'First_Name / Last_Name / User_Email will be empty and the ' +
           'representative will see an anonymous chat.');
    }

    // Boot Salesforce now so the customer is not waiting on a script download at
    // the moment they ask for a human.
    bootSalesforce().catch(function (err) {
      console.error('[mindset-sf-handoff] Salesforce failed to boot:', err);
    });

    if (options.autoRegister !== false) {
      autoRegisterPageTools();
    }
  }

  global.MindsetSalesforceHandoff = {
    init: init,
    handoff: handoff,
    registerPageTools: registerPageTools,
    config: CONFIG,
    _state: state
  };
})(window);
