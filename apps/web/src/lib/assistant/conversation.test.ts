import { expect, it } from "vitest";
import { recentConversation, type ConversationMessage } from "./conversation";

it("keeps the most recent turns in order without changing their roles", () => {
  const messages: ConversationMessage[] = Array.from({ length: 16 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `turn ${i}` }));
  expect(recentConversation(messages)).toEqual(messages.slice(-12));
  expect(messages).toHaveLength(16);
});
it("bounds long conversations and ignores empty messages", () => {
  expect(recentConversation([])).toEqual([]);
  expect(recentConversation([{ role: "user", content: "  " }])).toEqual([]);
  const result = recentConversation(Array.from({ length: 12 }, () => ({ role: "assistant", content: "a".repeat(6000) })));
  expect(result.reduce((sum, message) => sum + message.content.length, 0)).toBe(12000);
  expect(result.every(message => message.content.length <= 4000)).toBe(true);
});
