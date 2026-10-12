/**
 * Example inbound Guava voice agent, scaffolded by `guava create`.
 *
 * Run `guava run` from your project directory to call in and talk to it. Edit
 * the tasks and handlers below, then re-run to hear your changes.
 */

import { readFileSync } from "node:fs";
import * as guava from "@guava-ai/guava-sdk";
import { DocumentQA } from "@guava-ai/guava-sdk/helpers";

const logger = guava.getDefaultLogger();

let documentQA: DocumentQA | null = null;
try {
  const docs = readFileSync(new URL("./guava-docs.md", import.meta.url), "utf-8");
  documentQA = new DocumentQA({ documents: docs, namespace: "guava-cli-intro" });
} catch (exc) {
  logger.warn("Could not load Guava docs for RAG: %s", exc);
}

const agent = new guava.Agent({
  purpose:
    "You are an example voice agent shipped with the Guava CLI to show " +
    "the user they've successfully launched a working agent. Answer their " +
    "questions about the Guava platform, SDK, and CLI from your connected " +
    "knowledge base.",
});

agent.onCallStart(async (call: guava.Call) => {
  logger.info("Call started (session: %s)", call.id);
  await call.setTask({
    taskId: "intro",
    objective:
      "Walk the caller through a short introduction, then shift to " +
      "answering their questions about Guava from your knowledge base. " +
      "Complete the task once they have no more questions.",
    checklist: [
      guava.Say(
        "Hi! I'm a Guava voice agent, and you just launched me " +
          "using the Guava CLI. I can answer your questions about " +
          "using Guava.",
      ),
      guava.Field({
        key: "user_name",
        fieldType: "text",
        description:
          "Transition with 'But first,' then ask the caller for their name so you can address them personally.",
        required: false,
      }),
      "Answer any questions the caller has about Guava.",
      "Once the caller has no more questions, welcome them to Guava. " +
        "Point them to the Guava docs and examples library as resources " +
        "for building their own agent. Express that the team would love " +
        'to "hear what you build." Close warmly.',
    ],
  });
});

agent.onQuestion(async (_call: guava.Call, question: string) => {
  logger.info("Question received: %s", question);
  let answer: string;
  if (documentQA !== null) {
    answer = await documentQA.ask(question);
  } else {
    answer =
      "Unfortunately, I'm not able to answer that question right now, " +
      "because my knowledge base didn't load. To fix that, I recommend " +
      "verifying your network connection, then relaunching me.";
  }
  logger.info("Answering...");
  return answer;
});

agent.onTaskComplete("intro", async (call: guava.Call) => {
  const userName = await call.getField("user_name");
  if (userName) {
    logger.info("Intro task complete. Caller name: %s", userName);
  } else {
    logger.info("Intro task complete.");
  }
  await call.hangup();
});

agent.onSessionEnd(async (call: guava.Call, _event) => {
  logger.info("Session ended (session: %s)", call.id);
});

// Run this to attach your agent to a phone number. Call your agent's number to talk to it.
await agent.listenPhone("+12402514603");

// Run this to talk to your agent using your local audio device.
// await agent.callLocal();

// Run this to receive a WebRTC link where you can talk to your agent in the browser.
// await agent.listenWebrtc();

// Run this to test your agent in a text-based chat session in the terminal (no audio required).
// await agent.chat();