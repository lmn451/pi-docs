# Historical: async subagent conflict

Earlier versions of this extension called `ctx.abort()` when assistant output matched a doc, then sent a synthetic `continue` message from `agent_end`. This could interrupt async subagent workflows. The old implementation is described in repository history.

The extension no longer aborts the assistant response or sends `continue`. Matches in assistant text or thinking stay pending and are injected from `before_agent_start` on the next agent run. User input matches still inject before the immediate response.

If immediate mid-response injection is proposed again, test it against Pi's current agent lifecycle and async tools first. `agent_end` is not a final-idle signal; see [Pi's extension lifecycle](https://pi.dev/docs/latest/extensions#agent_start--agent_end--agent_before_settle--agent_settled).
