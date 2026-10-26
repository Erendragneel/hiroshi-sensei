# Hiroshi’s visual classroom in ChatGPT

This prototype keeps Hiroshi’s portrait, visual sentence tiles, English explanations, examples and homework alongside a ChatGPT conversation. It is a separate presentation mode from the standalone GitHub game.

The two read-only MCP tools only return an authored starter lesson or display lesson text supplied by the conversation’s model. They make no AI requests, read no OpenAI credentials, and store no conversations. The host conversation chooses the model and its usage allowance. Use this from normal ChatGPT **Chat** for the requested tutoring route; using it in Work or Codex still uses that host’s allowance.

`mcp.mjs` exposes tool discovery, lesson validation and the static `ui://hiroshi/classroom-v2.html` resource. `widget.mjs` contains the responsive classroom and the MCP Apps bridge. Its buttons send visible follow-up messages to the host conversation. Picture-in-picture and fullscreen are requested only when the host supports them. Opening the widget directly shows an authored preview; it does not generate answers.

The Site adapter checks the trusted Sites caller against the saved owner before running either display tool. Public discovery and resource metadata contain no account information. The existing Sites project hosts `/mcp` and provisions its own personal plugin when published. Phone UI, normal Chat integration and actual account usage must be verified before describing this as a working replacement for the installed game.

The GitHub Pages build publishes [the classroom preview](https://erendragneel.github.io/hiroshi-sensei/classroom-preview.html). The current standalone game connection continues to use the shared Codex / ChatGPT Work allowance and labels that explicitly. This prototype does not redirect that connection to a different quota.
