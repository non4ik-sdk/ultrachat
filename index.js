"use strict";

const TWITCH_WS = "wss://irc-ws.chat.twitch.tv:443";
const RECONNECT_DELAY = 3000;
const MAX_SCROLL_BUFFER_PX = 4000;

const messagesEl = document.getElementById("messages");
const chatEl = document.getElementById("chat");

let ws = null;
let reconnectTimer = null;

const TWITCH_CHANNEL = window.APP_CONFIG && window.APP_CONFIG.channel;

const BADGE_ICONS = { mod: "🛡️", vip: "💎", sub: "🚀"};

function addMessageSafe(username, badges, text, color) {
  const div = document.createElement("div");
  div.className = "msg";

  const nameSpan = document.createElement("span");
  nameSpan.style.color = color || "#f5d000";
  nameSpan.textContent = badges + username;

  const textSpan = document.createElement("span");
  textSpan.textContent = " + " + text;

  div.appendChild(nameSpan);
  div.appendChild(textSpan);
  messagesEl.appendChild(div);

  chatEl.scrollTop = chatEl.scrollHeight;

  const maxHeight = chatEl.clientHeight + MAX_SCROLL_BUFFER_PX;
  while (messagesEl.scrollHeight > maxHeight && messagesEl.firstChild) {
    messagesEl.removeChild(messagesEl.firstChild);
  }
}

function systemMessage(text) {
  const div = document.createElement("div");
  div.className = "msg";
  div.style.color = "#ffd000ff";
  div.textContent = text;
  messagesEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function connectTwitch() {
  if (!TWITCH_CHANNEL) {
    systemMessage("Channel not set");
    return;
  }

  if (ws) ws.close();

  ws = new WebSocket(TWITCH_WS);

  ws.onopen = function () {
    ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership");
    ws.send("PASS SCHMOOPIIE");
    ws.send("NICK justinfan" + Math.floor(Math.random() * 100000));
    ws.send("JOIN #" + TWITCH_CHANNEL);
    systemMessage("Connected to Twitch chat");
  };

  ws.onmessage = function (event) {
    const lines = event.data.split("\r\n");
    for (let i = 0; i < lines.length; i++) {
      parseMessage(lines[i]);
    }
  };

  ws.onclose = function () {
    systemMessage("Disconnected. Reconnecting...");
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(function () {
        reconnectTimer = null;
        connectTwitch();
      }, RECONNECT_DELAY);
    }
  };

  ws.onerror = function () {
    systemMessage("WebSocket error");
  };
}

function parseMessage(raw) {
  if (!raw) return;

  if (raw.startsWith("PING")) {
    ws.send("PONG :tmi.twitch.tv");
    return;
  }

  if (raw.indexOf("PRIVMSG") !== -1) {
    parsePrivMsg(raw);
  }
}

function parseTags(tagStr) {
  const tags = {};
  const parts = tagStr.split(";");

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const eq = p.indexOf("=");
    if (eq !== -1) {
      tags[p.slice(0, eq)] = p.slice(eq + 1);
    }
  }

  return tags;
}

function parsePrivMsg(raw) {
  let tags = {};
  let rest = raw;

  if (raw[0] === "@") {
    const space = raw.indexOf(" ");
    tags = parseTags(raw.slice(1, space));
    rest = raw.slice(space + 1);
  }

  if (rest[0] === ":") rest = rest.slice(1);

  const parts = rest.split(" ");
  const userPart = parts[0];
  const command = parts[1];

  if (command !== "PRIVMSG") return;

  const username = tags["display-name"] || userPart.split("!")[0];
  const msgIndex = rest.indexOf(" :");
  if (msgIndex === -1) return;

  const message = rest.slice(msgIndex + 2);

  let badges = "";
  if (tags.mod === "1") badges += BADGE_ICONS.mod;
  if (tags.vip === "1") badges += BADGE_ICONS.vip;
  if (tags.sub === "1") badges += BADGE_ICONS.sub;
  if (badges) badges += " ";

  addMessageSafe(username, badges, message, tags.color || "#f5d000");
}

systemMessage("Connecting to Twitch chat...");
connectTwitch();
