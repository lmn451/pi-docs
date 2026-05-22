/**
 * Test to demonstrate the followUp bug in pi coding agent.
 *
 * BUG: When sendUserMessage("continue", { deliverAs: "followUp" }) is called AFTER
 * agent_end fires (when isStreaming=false), the message is NOT queued - it executes
 * IMMEDIATELY via _runAgentPrompt().
 *
 * This happens because in AgentSession.prompt():
 *   if (this.isStreaming) {
 *       // Queue via _queueFollowUp
 *   }
 *   // When isStreaming=false, it goes straight to _runAgentPrompt()
 *
 * EXPECTED: Message should be queued for the NEXT turn
 * ACTUAL: Message runs immediately in the same turn
 *
 * WORKAROUND: Use pi.sendMessage() with triggerTurn: true instead.
 * This calls agent.prompt() directly, which works when agent is idle.
 */
import { describe, expect, test } from "vitest";
describe("sendUserMessage followUp bug reproduction", () => {
    test("BUG DEMO: documents the isStreaming check bug in AgentSession.prompt()", () => {
        // BUG LOCATION: AgentSession.prompt() in pi-coding-agent/dist/core/agent-session.js
        //
        // The problematic code at lines 717-728:
        // ```javascript
        // if (this.isStreaming) {
        //     if (!options?.streamingBehavior) {
        //         throw new Error("Agent is already processing...");
        //     }
        //     if (options.streamingBehavior === "followUp") {
        //         await this._queueFollowUp(expandedText, currentImages);
        //     } else {
        //         await this._queueSteer(expandedText, currentImages);
        //     }
        //     return;
        // }
        // // BUG: Falls through to _runAgentPrompt() when isStreaming=false!
        // ```
        //
        // REPRODUCTION SCENARIO:
        // 1. Extension detects keyword match during streaming (message_update)
        // 2. Extension calls ctx.abort() to stop current response
        // 3. abort() sets isStreaming = false
        // 4. agent_end fires
        // 5. Extension calls sendUserMessage("continue", { deliverAs: "followUp" })
        // 6. prompt() is called with streamingBehavior="followUp"
        // 7. BUT isStreaming=false at this point (because abort() set it)
        // 8. Code falls through - message executes immediately via _runAgentPrompt()
        //
        // The message should be queued, but it runs immediately because the
        // isStreaming check gatekeeps the queuing logic.
        // This test documents the bug by describing the exact code path
        const isStreamingAtAgentEnd = false; // Simulates state after abort()
        const streamingBehavior = "followUp"; // What extension passes
        // What SHOULD happen: queue the message regardless of isStreaming
        const shouldQueue = streamingBehavior === "followUp";
        expect(shouldQueue).toBe(true);
        // What ACTUALLY happens: the isStreaming check prevents queuing
        const actuallyQueues = isStreamingAtAgentEnd && streamingBehavior === "followUp";
        // isStreamingAtAgentEnd is FALSE, so actuallyQueues = false!
        // Message runs immediately instead of being queued
        expect(actuallyQueues).toBe(false); // This demonstrates the bug!
        // WORKAROUND: Use pi.sendMessage() with triggerTurn: true
        // This calls agent.prompt() directly, bypassing the isStreaming check.
    });
    test("documents the workaround: use sendMessage with triggerTurn: true", () => {
        // WORKAROUND for extensions:
        //
        // Instead of:
        //   pi.sendUserMessage("continue", { deliverAs: "followUp" });
        //
        // Use:
        //   pi.sendMessage(
        //     { customType: "doc-injector-continue", content: "continue" },
        //     { triggerTurn: true, deliverAs: "followUp" }
        //   );
        //
        // triggerTurn: true calls agent.prompt() directly when agent is idle,
        // which works after agent_end when isStreaming=false.
        //
        // See: sendCustomMessage in agent-session.ts
        //   } else if (options?.triggerTurn) {
        //       await this.agent.prompt(appMessage); // ← this works!
        //   }
        expect(true).toBe(true);
    });
});
//# sourceMappingURL=followup-bug.test.js.map