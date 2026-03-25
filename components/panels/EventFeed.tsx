"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Avatar,
  ChatContainer,
  Conversation,
  ConversationHeader,
  ConversationList,
  MainContainer,
  Message,
  MessageList,
  TypingIndicator,
} from "@chatscope/chat-ui-kit-react";
import type { AgentId, ChatThread } from "@/lib/types";

const agentNames: Record<AgentId, string> = {
  reed: "Modi",
  loom: "Rahul",
  clerk: "Mahesh",
  hammer: "Mola",
  witness: "Beggar",
  whisper: "Whisper",
};

function formatMembers(thread: ChatThread) {
  if (thread.memberIds.length === 0) return "Nobody active yet";
  return thread.memberIds.map((memberId) => agentNames[memberId]).join(", ");
}

function getPreview(thread: ChatThread) {
  const latest = thread.messages.at(-1);
  if (!latest) return "Thread is open for whoever speaks next.";
  return latest.text;
}

function prettifyLocation(locationId?: string) {
  if (!locationId) return "floating conversation";
  return locationId.replaceAll("_", " ");
}

function activityLabel(thread: ChatThread, currentTick: number) {
  const age = currentTick - thread.updatedTick;
  if (thread.updatedTick === 0) return "waiting";
  if (age <= 1) return "just now";
  if (age <= 3) return `${age} ticks ago`;
  return "quiet";
}

function getAvatarLetter(thread: ChatThread) {
  return thread.title.slice(0, 1).toUpperCase();
}

export function EventFeed({ threads }: { threads: ChatThread[] }) {
  const orderedThreads = useMemo(
    () =>
      [...threads].sort(
        (left, right) =>
          right.updatedTick - left.updatedTick || right.messages.length - left.messages.length || left.title.localeCompare(right.title),
      ),
    [threads],
  );

  const [activeThreadId, setActiveThreadId] = useState<string | null>(orderedThreads[0]?.id ?? null);

  useEffect(() => {
    if (!orderedThreads.length) {
      setActiveThreadId(null);
      return;
    }

    if (!activeThreadId || !orderedThreads.some((thread) => thread.id === activeThreadId)) {
      setActiveThreadId(orderedThreads[0].id);
    }
  }, [activeThreadId, orderedThreads]);

  const primary = orderedThreads.find((thread) => thread.id === activeThreadId) ?? orderedThreads[0] ?? null;
  const rest = orderedThreads.filter((thread) => thread.id !== primary?.id);
  const currentTick = orderedThreads.reduce((latest, thread) => Math.max(latest, thread.updatedTick), 0);
  const primaryMessages = useMemo(() => {
    if (!primary) return [];
    return [...primary.messages].sort((left, right) => left.tick - right.tick);
  }, [primary]);

  if (!primary) {
    return (
      <section className="threads-shell">
        <div className="hud-label">Village Chat</div>
        <div className="sdk-chat-shell empty-chat-shell">
          <div className="chat-empty-state">No village threads are active yet.</div>
        </div>
      </section>
    );
  }

  return (
    <section className="threads-shell">
      <div className="hud-label">Village Chat</div>

      <div className="sdk-chat-shell">
        <MainContainer>
          <ConversationList>
            {orderedThreads.map((thread) => (
              <Conversation
                key={thread.id}
                active={primary?.id === thread.id}
                info={getPreview(thread)}
                lastActivityTime={activityLabel(thread, currentTick)}
                name={thread.title}
                onClick={() => setActiveThreadId(thread.id)}
                unreadCnt={thread.messages.length}
              >
                <Avatar name={thread.title}>{getAvatarLetter(thread)}</Avatar>
                <Conversation.Content info={formatMembers(thread)} name={thread.title} />
              </Conversation>
            ))}
          </ConversationList>

          <ChatContainer>
            <ConversationHeader>
              <Avatar name={primary.title}>{getAvatarLetter(primary)}</Avatar>
              <ConversationHeader.Content
                info={`${prettifyLocation(primary.locationId)} - ${formatMembers(primary)}`}
                userName={primary.title}
              />
              <ConversationHeader.Actions>
                <div className="chat-thread-pill">{primary.memberIds.length} present</div>
              </ConversationHeader.Actions>
            </ConversationHeader>

            <MessageList
              autoScrollToBottom
              autoScrollToBottomOnMount
              scrollBehavior="smooth"
              typingIndicator={primary.memberIds.length > 0 ? <TypingIndicator content={`${formatMembers(primary)} nearby`} /> : undefined}
            >
              {primaryMessages.length === 0 ? (
                <Message
                  model={{
                    direction: "incoming",
                    message: "The thread is open, but nobody has said anything yet.",
                    position: "single",
                    sender: "system",
                    sentTime: "waiting",
                  }}
                  type="text"
                >
                  <Message.Header sender="system" sentTime="waiting" />
                </Message>
              ) : (
                primaryMessages.map((message, index) => {
                  const direction = message.authorId === "hammer" || message.authorId === "loom" ? "outgoing" : "incoming";
                  const position =
                    primaryMessages.length === 1
                      ? "single"
                      : index === 0
                        ? "first"
                        : index === primaryMessages.length - 1
                          ? "last"
                          : "normal";

                  return (
                    <Message
                      key={message.id}
                      model={{
                        direction,
                        message: message.text,
                        position,
                        sender: message.authorId ? agentNames[message.authorId] : "system",
                        sentTime: `tick ${message.tick}`,
                      }}
                      type="text"
                    >
                      <Message.Header sender={message.authorId ? agentNames[message.authorId] : "system"} sentTime={`tick ${message.tick}`} />
                    </Message>
                  );
                })
              )}
            </MessageList>
          </ChatContainer>
        </MainContainer>
      </div>

      {rest.length > 0 ? (
        <div className="thread-strip">
          {rest.map((thread) => (
            <button className="thread-pill" key={thread.id} onClick={() => setActiveThreadId(thread.id)} type="button">
              <span>#{thread.title}</span>
              <span>{thread.messages.length}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
