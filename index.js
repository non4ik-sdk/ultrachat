"use strict";

const CFG = window.APP_CONFIG;

const TWITCH_WS = CFG.twitch.ws;
const RECONNECT_DELAY = CFG.twitch.reconnectDelay;
const MAX_SCROLL_BUFFER_PX = CFG.chat.maxScrollBufferPx;

const API_7TV_GLOBAL = CFG.sevenTV.globalApi;
const API_7TV_USER = CFG.sevenTV.userApi;

const CF_PROXY = typeof CFG.proxy === "string" ? CFG.proxy.trim() : "";
const USE_PROXY = CF_PROXY !== "";

const ENABLE_7TV = CFG.sevenTV.enabled;

const messagesEl = document.getElementById("messages");
const chatEl = document.getElementById("chat");

let ws = null;
let reconnectTimer = null;

const TWITCH_CHANNEL = CFG.channel;
const BADGE_ICONS = { mod: "🛡️", vip: "💎", sub: "🚀" };

let globalLoaded = false;
let sevenTVMap = {};
let emoteCache = {};
let channelLoaded = {};

// utils
function log() { try { console.log.apply(console, arguments); } catch (e) {} }
function warn() { try { console.warn.apply(console, arguments); } catch (e) {} }
function error() { try { console.error.apply(console, arguments); } catch (e) {} }

function proxify(url) {
  if (!url) return "";

  url = url.replace(/^\/\//, "https://");
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;

  if (!USE_PROXY) return url;

  return CF_PROXY + encodeURIComponent(url);
}

function pickEmoteFileUrl(host) {
  if (!host || !Array.isArray(host.files) || !host.files.length) return "";
  for (let i = 0; i < host.files.length; i++) {
    const f = host.files[i];
    if (typeof f.name === "string" && f.name.indexOf("1x") === 0) {
      return host.url + "/" + f.name;
    }
  }
  return host.url + "/" + host.files[0].name;
}

// 7TV
async function loadGlobal7TV() {
  if (!ENABLE_7TV) return;

  try {
    const url = USE_PROXY ? proxify(API_7TV_GLOBAL) : API_7TV_GLOBAL;
    const res = await fetch(url);
    if (!res.ok) {
      warn("[7TV] Global HTTP error:", res.status);
      return;
    }

    const json = await res.json();

    if (!json || !Array.isArray(json.emotes)) {
      warn("[7TV] No global emotes");
      return;
    }

    for (let i = 0; i < json.emotes.length; i++) {
      const em = json.emotes[i];
      if (!em.name || !em.data || !em.data.host) continue;

      const rawUrl = pickEmoteFileUrl(em.data.host);
      if (!rawUrl) continue;

      const finalUrl = USE_PROXY ? proxify(rawUrl) : rawUrl;

      sevenTVMap[em.name] = {
        url: finalUrl,
        source: "global"
      };
    }

    globalLoaded = true;
    log("[7TV] Global loaded:", Object.keys(sevenTVMap).length);
  } catch (e) {
    error("[7TV] Global failed:", e);
  }
}

async function loadChannel7TV(twitchId) {
  if (!ENABLE_7TV || !twitchId || channelLoaded[twitchId]) return;

  channelLoaded[twitchId] = true;

  try {
    const apiUrl = API_7TV_USER + twitchId;
    const url = USE_PROXY ? proxify(apiUrl) : apiUrl;

    const res = await fetch(url);
    if (!res.ok) {
      warn("[7TV] Channel HTTP error:", res.status);
      return;
    }

    const json = await res.json();

    if (!json || !json.emote_set || !Array.isArray(json.emote_set.emotes)) {
      warn("[7TV] No channel emotes");
      return;
    }

    const emotes = json.emote_set.emotes;

    for (let i = 0; i < emotes.length; i++) {
      const em = emotes[i];
      if (!em.name || !em.data || !em.data.host) continue;

      const rawUrl = pickEmoteFileUrl(em.data.host);
      if (!rawUrl) continue;

      const finalUrl = USE_PROXY ? proxify(rawUrl) : rawUrl;

      sevenTVMap[em.name] = {
        url: finalUrl,
        source: "channel",
        channelId: twitchId
      };
    }

    log("[7TV] Channel loaded:", twitchId);
  } catch (e) {
    error("[7TV] Channel failed:", e);
  }
}

// Link + emote rendering
function appendToken(frag, token) {

  if (/^\s+$/.test(token)) {
    frag.appendChild(document.createTextNode(token));
    return;
  }

  const urlMatch = token.match(/^(https?:\/\/[^\s]+)$/i);
  if (urlMatch) {
    const a = document.createElement("a");
    a.href = token;
    a.textContent = token;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.style.color = "#4aa3ff";
    frag.appendChild(a);
    return;
  }

  if (ENABLE_7TV && sevenTVMap[token]) {
    const em = sevenTVMap[token];

    if (!emoteCache[token]) {
      const img = document.createElement("img");
      img.src = em.url;
      img.alt = token;
      img.className = "emote";
      img.style.height = "1em";
      img.style.verticalAlign = "middle";
      img.loading = "lazy";
      emoteCache[token] = img;
    }

    frag.appendChild(emoteCache[token].cloneNode(true));
    return;
  }

  frag.appendChild(document.createTextNode(token));
}

// Chat rendering
function addMessageSafe(username, badges, text, color, roomId) {

  const div = document.createElement("div");
  div.className = "msg";

  const nameSpan = document.createElement("span");
  nameSpan.style.color = color || "#f5d000";
  nameSpan.textContent = badges + username + ": ";
  div.appendChild(nameSpan);

  const textSpan = document.createElement("span");
  const frag = document.createDocumentFragment();

  const tokens = text.split(/(\s+)/);

  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i]) continue;
    appendToken(frag, tokens[i]);
  }

  textSpan.appendChild(frag);
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
}

// Twitch

function connectTwitch() {
  if (!TWITCH_CHANNEL) {
    systemMessage("Channel not set");
    return;
  }

  ws = new WebSocket(TWITCH_WS);

  ws.onopen = function () {
    ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership");
    ws.send("PASS SCHMOOPIIE");
    ws.send("NICK justinfan" + Math.floor(Math.random() * 100000));
    ws.send("JOIN #" + TWITCH_CHANNEL);
    systemMessage("Connected");
  };

  ws.onmessage = function (event) {
    const lines = event.data.split("\r\n");
    for (let i = 0; i < lines.length; i++) parseMessage(lines[i]);
  };

  ws.onclose = function () {
    systemMessage("Reconnecting...");
    reconnectTimer = setTimeout(function () {
      connectTwitch();
    }, RECONNECT_DELAY);
  };
}

function parseMessage(raw) {
  if (!raw) return;

  if (raw.indexOf("PING") === 0) {
    ws.send("PONG :tmi.twitch.tv");
    return;
  }

  if (raw.indexOf("PRIVMSG") !== -1) parsePrivMsg(raw);
}

function parseTags(tagStr) {
  const tags = {};
  const parts = tagStr.split(";");
  for (let i = 0; i < parts.length; i++) {
    const eq = parts[i].indexOf("=");
    if (eq !== -1) tags[parts[i].slice(0, eq)] = parts[i].slice(eq + 1);
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
  if (parts[1] !== "PRIVMSG") return;

  const username = tags["display-name"] || parts[0].split("!")[0];
  const msgIndex = rest.indexOf(" :");
  if (msgIndex === -1) return;

  const message = rest.slice(msgIndex + 2);
  const roomId = tags["room-id"];

  if (ENABLE_7TV && roomId) loadChannel7TV(roomId);

  let badges = "";
  if (tags.mod === "1") badges += BADGE_ICONS.mod;
  if (tags.vip === "1") badges += BADGE_ICONS.vip;
  if (tags.sub === "1") badges += BADGE_ICONS.sub;
  if (badges) badges += " ";

  addMessageSafe(username, badges, message, tags.color, roomId);
}

// init
systemMessage("Connecting to Twitch...");
loadGlobal7TV().then(function () {
  connectTwitch();
});