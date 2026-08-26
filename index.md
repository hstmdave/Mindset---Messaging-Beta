<script type='text/javascript'>
	function initEmbeddedMessaging() {
		try {
			embeddedservice_bootstrap.settings.language = 'en_US'; // For example, enter 'en' or 'en-US'

      // adding event listener to chat initialization
      window.addEventListener("onEmbeddedMessagingReady", () => {

        // passing hidden pre-chat values (use the exact Channel Variable names from Setup)
        // will need to set up a lot of these depending on values that CustEx wants mapped
        embeddedservice_bootstrap.prechatAPI.setHiddenPrechatFields({
          	"External_Conversation_Id": replaceThisValue,  // Replace with corresponding variable from Mindset
        	"PreChat_URL": window.location.origin,
			"First_Name": replaceThisValue,  // Replace with corresponding variable from Mindset
			"Last_Name": replaceThisValue,  // Replace with corresponding variable from Mindset
			"User_Email": replaceThisValue,  // Replace with corresponding variable from Mindset
        });
    });

			embeddedservice_bootstrap.init(
				'00DWL00000C6ZOy',
				'Mindset_Messaging_Beta',
				'https://healthstream--hstm.sandbox.my.site.com/ESWMindsetMessagingBeta1787680662848',
				{
					scrt2URL: 'https://healthstream--hstm.sandbox.my.salesforce-scrt.com'
				}
			);
		} catch (err) {
			console.error('Error loading Embedded Messaging: ', err);
		}
	};
</script>
<script type='text/javascript' src='https://healthstream--hstm.sandbox.my.site.com/ESWMindsetMessagingBeta1787680662848/assets/js/bootstrap.min.js' onload='initEmbeddedMessaging()'></script>
