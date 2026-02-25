"use strict";

window.APP_CONFIG = {
  channel: "twitch", // Name of Twitch channel (Not full url)

  twitch: {
    ws: "wss://irc-ws.chat.twitch.tv:443",
    reconnectDelay: 3000 
  },

  chat: {
    maxScrollBufferPx: 4000 
  },

  sevenTV: {
    enabled: true, // Enable/Disable 7TV emotes. 
    globalApi: "https://7tv.io/v3/emote-sets/global",
    userApi: "https://7tv.io/v3/users/twitch/"
  },

  proxy: "https://cp.non4ik.workers.dev/?url=" // I use my simple CF Worker https://github.com/non4ik-sdk/CacheProxy

};
